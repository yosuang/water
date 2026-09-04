import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureWaterProjectDirectory } from "@water/config";
import { CaptureAuthorization } from "./capture-authorization.ts";
import { type ExperienceConfigOptions, resolveLearningsDir } from "./experience-config.ts";
import { type ExperienceHintEntry, frictionHint, hintWidgetLines, renderExperienceHint } from "./experience-hint.ts";
import { ExperienceRecall } from "./experience-recall.ts";
import { type LearningCard, LearningValidationError, SAVE_LEARNING_PARAMETERS } from "./learning-card.ts";
import { type LearningSearchResult, LearningStore, type SavedLearning } from "./learning-store.ts";
import {
  type ExperienceStateEntry,
  evaluateSessionFriction,
  hasAssistantResponse,
  hasCapturableFriction,
  isCorrectionPrompt,
  shouldHintForLearning,
} from "./session-friction.ts";

const STATE_ENTRY_TYPE = "water-experience-loop-state";
const HINT_ENTRY_TYPE = "water-experience-hint";
const HINT_WIDGET_KEY = "water-experience-hint";
const CAPTURE_SKILL_PATH = fileURLToPath(new URL("../skills/capture-learning/SKILL.md", import.meta.url));

export type ExperienceLoopOptions = ExperienceConfigOptions & {
  now?: () => Date;
};

export default function experienceLoopExtension(pi: ExtensionAPI, options: ExperienceLoopOptions = {}) {
  const now = options.now ?? (() => new Date());
  const captureAuthorization = new CaptureAuthorization(CAPTURE_SKILL_PATH);
  let store: LearningStore | undefined;
  let recall: ExperienceRecall | undefined;

  const activeStore = (): LearningStore => {
    if (!store) throw new Error("Experience loop session has not started.");
    return store;
  };
  const activeRecall = (): ExperienceRecall => {
    if (!recall) throw new Error("Experience loop session has not started.");
    return recall;
  };
  const recordRecall = (results: LearningSearchResult[]): void => {
    pi.appendEntry(STATE_ENTRY_TYPE, {
      kind: "recalled",
      ids: results.map((result) => result.id),
      timestamp: now().getTime(),
    } satisfies ExperienceStateEntry);
  };

  pi.registerEntryRenderer<ExperienceHintEntry>(HINT_ENTRY_TYPE, renderExperienceHint);

  pi.on("session_start", async (_event, ctx) => {
    const learningsDir = resolveLearningsDir(ctx.cwd, options, (message) => ctx.ui.notify(message, "warning"));
    store = new LearningStore(learningsDir);
    recall = new ExperienceRecall(store, recordRecall);
    captureAuthorization.reset();

    // A widget from the previous runtime instance (reload/session switch) may still be on screen.
    // Re-pin it when the restored branch still holds uncaptured friction, otherwise clear the stale one.
    if (ctx.mode === "tui") {
      const friction = evaluateSessionFriction(ctx.sessionManager.getBranch(), STATE_ENTRY_TYPE);
      ctx.ui.setWidget(HINT_WIDGET_KEY, hasCapturableFriction(friction) ? hintWidgetLines(friction) : undefined);
    }

    try {
      await ensureWaterProjectDirectory(ctx.cwd);
      const result = await store.reload();
      if (ctx.hasUI && result.skipped > 0) {
        ctx.ui.notify(
          `Skipped ${result.skipped} malformed learning ${result.skipped === 1 ? "file" : "files"}.`,
          "warning",
        );
      }
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Experience recall unavailable: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });

  pi.on("input", (event, ctx) => {
    // The hint widget deliberately stays pinned here; only a successful save takes it down.
    if (event.source === "extension") return;
    if (event.streamingBehavior === "steer") {
      pi.appendEntry(STATE_ENTRY_TYPE, {
        kind: "interrupt",
        timestamp: now().getTime(),
      } satisfies ExperienceStateEntry);
    }
    if (captureAuthorization.observeInput(event.text)) return;

    if (hasAssistantResponse(ctx.sessionManager.getBranch()) && isCorrectionPrompt(event.text)) {
      pi.appendEntry(STATE_ENTRY_TYPE, {
        kind: "correction",
        timestamp: now().getTime(),
      } satisfies ExperienceStateEntry);
    }
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "user") return;
    activeRecall().onUserMessage(event.message.content, (prompt) => captureAuthorization.observeExpandedPrompt(prompt));
  });

  pi.on("before_agent_start", async (event) => {
    const captureAttempt = captureAuthorization.observeExpandedPrompt(event.prompt);
    const recalled = activeRecall().onBeforeAgent(event.prompt, captureAttempt);
    if (!recalled) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${recalled}`,
    };
  });

  pi.on("context", (event) => {
    const recalled = activeRecall().drainQueuedContexts();
    if (recalled.length === 0) return;
    return {
      messages: [
        ...event.messages,
        ...recalled.map((content) => ({
          role: "custom" as const,
          customType: "water-experience-recall",
          content,
          display: false,
          timestamp: now().getTime(),
        })),
      ],
    };
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (captureAuthorization.clearAfterAgentSettled()) return;

    const friction = evaluateSessionFriction(ctx.sessionManager.getBranch(), STATE_ENTRY_TYPE);
    if (!ctx.hasUI || !shouldHintForLearning(friction)) return;

    pi.appendEntry(STATE_ENTRY_TYPE, {
      kind: "hinted",
      timestamp: now().getTime(),
    } satisfies ExperienceStateEntry);
    pi.appendEntry(HINT_ENTRY_TYPE, { friction } satisfies ExperienceHintEntry);

    if (ctx.mode === "tui") {
      ctx.ui.setWidget(HINT_WIDGET_KEY, hintWidgetLines(friction));
      return;
    }
    ctx.ui.notify(frictionHint(friction), "info");
  });

  pi.registerTool({
    name: "save_learning",
    label: "Save Learning",
    description:
      "Save one user-approved, reusable learning to Pi's local learning store. Use only while following the capture-learning skill.",
    parameters: SAVE_LEARNING_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      captureAuthorization.consumeGrant();
      let saved: SavedLearning;
      try {
        saved = await activeStore().save(params as LearningCard, now());
      } catch (error) {
        if (error instanceof LearningValidationError) captureAuthorization.restoreGrant();
        throw error;
      }
      pi.appendEntry(STATE_ENTRY_TYPE, {
        kind: "saved",
        id: saved.id,
        timestamp: now().getTime(),
      } satisfies ExperienceStateEntry);
      // Saving fulfilled the pinned reminder, so this is the one place the widget comes down.
      if (ctx.mode === "tui") ctx.ui.setWidget(HINT_WIDGET_KEY, undefined);
      if (ctx.hasUI) ctx.ui.notify(`Saved learning: ${saved.id}`, "info");

      return {
        content: [
          {
            type: "text",
            text: `${saved.created ? "Saved learning" : "Learning already exists"}: ${saved.id}\n${saved.path}`,
          },
        ],
        details: saved,
      };
    },
  });
}
