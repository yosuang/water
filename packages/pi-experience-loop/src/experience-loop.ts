import { type ExtensionFactory, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createAgentSessionIdentity } from "./agent-session.ts";
import { frictionHint, hintWidgetLines } from "./experience-hint.ts";
import { ExperienceRecall } from "./experience-recall.ts";
import { type LearningConfigOptions, resolveLearningsDir } from "./learning-config.ts";
import { LearningStore } from "./learning-store.ts";
import { hasAssistantResponse, isCorrectionPrompt, measurePiToolActivity } from "./pi-session-friction.ts";
import { evaluateSessionFriction, hasCapturableFriction, shouldHintForLearning } from "./session-friction.ts";
import {
  type AgentSessionState,
  type SessionFrictionState,
  type SessionStateEvent,
  SessionStateStore,
} from "./session-state.ts";
import { ensureWaterProjectDirectory } from "./water-project.ts";

const HINT_WIDGET_KEY = "water-experience-hint";

export type ExperienceLoopOptions = LearningConfigOptions & {
  now?: () => Date;
};

export function createExperienceLoopExtension(options: ExperienceLoopOptions = {}): ExtensionFactory {
  return function experienceLoopExtension(pi) {
    const now = options.now ?? (() => new Date());
    let branchBaselineLength = 0;
    let recall: ExperienceRecall | undefined;
    let sessionState: SessionStateStore | undefined;
    let toolActivityBase: SessionFrictionState = {
      correction: 0,
      interrupt: 0,
      toolCount: 0,
      toolError: 0,
      toolNames: [],
    };

    const activeRecall = (): ExperienceRecall => {
      if (!recall) throw new Error("Experience loop session has not started.");
      return recall;
    };
    const activeSessionState = (): SessionStateStore => {
      if (!sessionState) throw new Error("Experience loop session has not started.");
      return sessionState;
    };

    pi.on("session_start", async (_event, ctx) => {
      branchBaselineLength = ctx.sessionManager.getBranch().length;
      await ensureWaterProjectDirectory(ctx.cwd);
      const identity = createAgentSessionIdentity("pi", ctx.sessionManager.getSessionId());
      sessionState = new SessionStateStore(ctx.cwd, identity);

      try {
        const state = await sessionState.ensure(now().getTime());
        toolActivityBase = { ...state.friction, toolNames: [...state.friction.toolNames] };
        if (ctx.mode === "tui") {
          const friction = evaluateSessionFriction(state);
          ctx.ui.setWidget(HINT_WIDGET_KEY, hasCapturableFriction(friction) ? hintWidgetLines(friction) : undefined);
        }
      } catch (error) {
        if (ctx.mode === "tui") ctx.ui.setWidget(HINT_WIDGET_KEY, undefined);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Experience session state unavailable: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
      }

      const learningsDir = resolveLearningsDir(
        ctx.cwd,
        { agentDir: options.agentDir ?? getAgentDir(), learningsDir: options.learningsDir },
        (message) => ctx.ui.notify(message, "warning"),
      );
      const store = new LearningStore(learningsDir);
      recall = new ExperienceRecall(store);
      try {
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

    pi.on("input", async (event, ctx) => {
      if (event.source === "extension") return;
      const events: SessionStateEvent[] = [];
      if (event.streamingBehavior === "steer") {
        events.push({ type: "interrupt", at: now().getTime() });
      }
      if (hasAssistantResponse(ctx.sessionManager.getBranch()) && isCorrectionPrompt(event.text)) {
        events.push({ type: "correction", at: now().getTime() });
      }
      if (events.length > 0) await activeSessionState().apply(events);
    });

    pi.on("message_end", async (event) => {
      if (event.message.role !== "user") return;
      await activeRecall().onUserMessage(event.message.content);
    });

    pi.on("before_agent_start", async (event) => {
      const recalled = await activeRecall().onBeforeAgent(event.prompt);
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

    pi.on("agent_settled", async (_event, ctx) => {
      let state: AgentSessionState;
      try {
        const observed = measurePiToolActivity(ctx.sessionManager.getBranch().slice(branchBaselineLength));
        state = await activeSessionState().apply({
          type: "tool-activity",
          at: now().getTime(),
          activity: {
            aborted: toolActivityBase.interrupt + observed.aborted,
            toolCount: toolActivityBase.toolCount + observed.toolCount,
            toolError: toolActivityBase.toolError + observed.toolError,
            toolNames: [...toolActivityBase.toolNames, ...observed.toolNames],
          },
        });
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Experience session state unavailable: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
        return;
      }

      const friction = evaluateSessionFriction(state);
      if (friction.hasSaved) {
        if (ctx.mode === "tui") ctx.ui.setWidget(HINT_WIDGET_KEY, undefined);
        return;
      }
      if (!ctx.hasUI || !shouldHintForLearning(friction)) return;

      await activeSessionState().apply({ type: "hinted", at: now().getTime() });
      if (ctx.mode === "tui") {
        ctx.ui.setWidget(HINT_WIDGET_KEY, hintWidgetLines(friction));
        return;
      }
      ctx.ui.notify(frictionHint(friction), "info");
    });
  };
}

export default createExperienceLoopExtension();
