import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, Key, type KeyId, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const IS_MACOS = process.platform === "darwin";
const TRANSFER_KEYS: readonly KeyId[] = IS_MACOS ? [Key.super("s"), Key.ctrl("s")] : [Key.ctrl("s")];

const STATE_ENTRY_TYPE = "water-prompt-stash-state";
const WIDGET_KEY = "prompt-stash";
const PREVIEW_LENGTH = 10;
const WIDGET_INDENT = "   ";
const CARRYOVER_REGISTRY_KEY = Symbol.for("water.prompt-stash.carryover-registry");

type StateEntry = { action: "stash"; prompt: string; timestamp: number } | { action: "clear"; timestamp: number };

function getCarryoverRegistry(): Map<string, string> {
  // Pi recreates extension modules and their event bus during session replacement.
  // Keep a process-local mailbox keyed by the destination session instead.
  const globalState = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existingRegistry = globalState[CARRYOVER_REGISTRY_KEY];
  if (existingRegistry instanceof Map) return existingRegistry as Map<string, string>;

  const registry = new Map<string, string>();
  globalState[CARRYOVER_REGISTRY_KEY] = registry;
  return registry;
}

function carryoverKey(sessionFile: string | undefined, cwd: string): string {
  return sessionFile ? `session:${sessionFile}` : `memory:${cwd}`;
}

function stageSessionCarryover(
  targetSessionFile: string | undefined,
  cwd: string,
  prompt: string | undefined,
): void {
  const registry = getCarryoverRegistry();
  const key = carryoverKey(targetSessionFile, cwd);
  if (prompt) {
    registry.set(key, prompt);
  } else {
    registry.delete(key);
  }
}

function consumeSessionCarryover(ctx: ExtensionContext): string | undefined {
  const registry = getCarryoverRegistry();
  const key = carryoverKey(ctx.sessionManager.getSessionFile(), ctx.cwd);
  const prompt = registry.get(key);
  registry.delete(key);
  return prompt;
}

function matchesTransferKey(data: string): boolean {
  return TRANSFER_KEYS.some((key) => matchesKey(data, key));
}

function wrapEditor(baseEditor: EditorComponent, onTransfer: () => void): EditorComponent {
  return new Proxy(baseEditor, {
    get(target, property) {
      if (property === "handleInput") {
        return (data: string) => {
          if (matchesTransferKey(data)) {
            onTransfer();
            return;
          }

          target.handleInput(data);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function formatPreview(prompt: string): string {
  const chars = Array.from(prompt);
  const preview = chars
    .slice(0, PREVIEW_LENGTH)
    .join("")
    .replace(/\r\n|\r|\n/gu, "↵")
    .replace(/\t/gu, "⇥");

  return chars.length > PREVIEW_LENGTH ? `${preview}…` : preview;
}

function restoreState(ctx: ExtensionContext): string | undefined {
  let restoredPrompt: string | undefined;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;

    const data = entry.data as StateEntry | undefined;
    if (!data) continue;

    if (data.action === "stash" && typeof data.prompt === "string") {
      restoredPrompt = data.prompt;
    } else if (data.action === "clear") {
      restoredPrompt = undefined;
    }
  }

  return restoredPrompt;
}

function formatWidgetText(prompt: string): string {
  return `${WIDGET_INDENT}> Stashed (${formatPreview(prompt)})`;
}

export default function promptStashExtension(pi: ExtensionAPI) {
  let stashedPrompt: string | undefined;

  function persistState(prompt: string | undefined): void {
    const entry: StateEntry = prompt
      ? { action: "stash", prompt, timestamp: Date.now() }
      : { action: "clear", timestamp: Date.now() };
    pi.appendEntry(STATE_ENTRY_TYPE, entry);
  }

  function setStashedPrompt(prompt: string | undefined): void {
    stashedPrompt = prompt;
    persistState(prompt);
  }

  function updateWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    if (!stashedPrompt) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }

    const prompt = stashedPrompt;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render(width) {
        return [truncateToWidth(theme.fg("dim", formatWidgetText(prompt)), width, "")];
      },
      invalidate() {},
    }));
  }

  function restoreStash(ctx: ExtensionContext): void {
    stashedPrompt = restoreState(ctx);
    updateWidget(ctx);
  }

  function transferDraft(ctx: ExtensionContext): void {
    const inputDraft = ctx.ui.getEditorText();
    if (inputDraft.trim().length > 0) {
      setStashedPrompt(inputDraft);
      ctx.ui.setEditorText("");
      updateWidget(ctx);
      return;
    }

    if (!stashedPrompt) return;

    const draftToRestore = stashedPrompt;
    setStashedPrompt(undefined);
    ctx.ui.setEditorText(draftToRestore);
    updateWidget(ctx);
  }

  pi.on("session_start", (event, ctx) => {
    const carryoverPrompt = event.reason === "new" && ctx.mode === "tui" ? consumeSessionCarryover(ctx) : undefined;

    restoreStash(ctx);
    if (ctx.mode !== "tui") return;

    const previousEditorFactory = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const baseEditor = previousEditorFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      return wrapEditor(baseEditor, () => transferDraft(ctx));
    });

    if (!carryoverPrompt) return;
    if (ctx.ui.getEditorText().trim().length > 0) {
      ctx.ui.notify("Session Carryover skipped because the new Prompt Editor is not empty.", "warning");
      return;
    }

    ctx.ui.setEditorText(carryoverPrompt);
  });

  pi.on("session_shutdown", (event, ctx) => {
    if (event.reason !== "new" || ctx.mode !== "tui") return;
    stageSessionCarryover(event.targetSessionFile, ctx.cwd, stashedPrompt);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreStash(ctx);
  });
}
