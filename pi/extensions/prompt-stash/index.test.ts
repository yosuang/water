import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteProvider, EditorComponent } from "@earendil-works/pi-tui";
import promptStashExtension from "./index.ts";

type ShortcutHandler = (ctx: any) => Promise<void> | void;
type EventHandler = (event: any, ctx: any) => Promise<void> | void;
type EditorFactory = (...args: any[]) => EditorComponent;

type FakeEditor = EditorComponent & {
  actionHandlers: Map<string, () => void>;
  autocompleteMaxVisible?: number;
  autocompleteProvider?: unknown;
  focused: boolean;
  handledInputs: string[];
  history: string[];
  insertedText: string[];
  invalidations: number;
  padding?: number;
  renderWidths: number[];
};

type LoadExtensionOptions = {
  hasExistingEditor?: boolean;
};

function createFakeEditor(initialText: string): FakeEditor {
  let text = initialText;

  return {
    actionHandlers: new Map(),
    borderColor: (value) => `[${value}]`,
    focused: false,
    handledInputs: [],
    history: [],
    insertedText: [],
    invalidations: 0,
    renderWidths: [],
    wantsKeyRelease: true,
    addToHistory(value) {
      this.history.push(value);
    },
    getExpandedText: () => text,
    getText: () => text,
    handleInput(data: string) {
      this.handledInputs.push(data);
    },
    insertTextAtCursor(value) {
      this.insertedText.push(value);
    },
    invalidate() {
      this.invalidations += 1;
    },
    render(width) {
      this.renderWidths.push(width);
      return [text];
    },
    setAutocompleteMaxVisible(value) {
      this.autocompleteMaxVisible = value;
    },
    setAutocompleteProvider(value) {
      this.autocompleteProvider = value;
    },
    setPaddingX(value) {
      this.padding = value;
    },
    setText(nextText: string) {
      text = nextText;
    },
  };
}

function loadExtension(
  initialEditorText: string,
  branch: unknown[] = [],
  { hasExistingEditor = true }: LoadExtensionOptions = {},
) {
  const shortcuts = new Map<string, ShortcutHandler>();
  const handlers = new Map<string, EventHandler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const baseEditor = createFakeEditor(initialEditorText);
  let activeEditor: EditorComponent = baseEditor;
  let editorInstallations = 0;

  promptStashExtension({
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
    on(eventName: string, handler: EventHandler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
    registerShortcut(shortcut: string, options: { handler: ShortcutHandler }) {
      shortcuts.set(shortcut, options.handler);
    },
  } as any);

  const ctx = {
    hasUI: true,
    mode: "tui",
    sessionManager: {
      getBranch: () => branch,
    },
    ui: {
      getEditorComponent: () => (hasExistingEditor ? ((() => baseEditor) as EditorFactory) : undefined),
      getEditorText: () => activeEditor.getExpandedText?.() ?? activeEditor.getText(),
      setEditorComponent: (factory: EditorFactory) => {
        editorInstallations += 1;
        activeEditor = factory({}, {}, {});
      },
      setEditorText: (text: string) => {
        activeEditor.setText(text);
      },
      setWidget() {},
    },
  };

  return {
    baseEditor,
    entries,
    getActiveEditor: () => activeEditor,
    getEditorInstallations: () => editorInstallations,
    getEditorText: () => activeEditor.getExpandedText?.() ?? activeEditor.getText(),
    handlers,
    pressEditor: (data: string) => activeEditor.handleInput(data),
    setEditorText: (text: string) => {
      activeEditor.setText(text);
    },
    shortcuts,
    ctx,
  };
}

async function startExtension(extension: ReturnType<typeof loadExtension>): Promise<void> {
  const sessionStart = extension.handlers.get("session_start")?.[0];
  assert.ok(sessionStart);
  await sessionStart({}, extension.ctx);
}

const TRANSFER_KEY_INPUT = "\x13";

test("session start wraps the existing editor and delegates ordinary input", async () => {
  const extension = loadExtension("draft");
  await startExtension(extension);
  extension.pressEditor("x");

  assert.equal(extension.getEditorInstallations(), 1);
  assert.deepEqual(extension.baseEditor.handledInputs, ["x"]);
});

test("the editor adapter delegates the complete EditorComponent interface", async () => {
  const extension = loadExtension("draft");
  await startExtension(extension);

  const adapter = extension.getActiveEditor() as FakeEditor;
  const autocompleteProvider = {} as AutocompleteProvider;
  let changedText: string | undefined;
  let submittedText: string | undefined;
  adapter.onChange = (text) => {
    changedText = text;
  };
  adapter.onSubmit = (text) => {
    submittedText = text;
  };
  adapter.focused = true;
  adapter.addToHistory?.("history");
  adapter.insertTextAtCursor?.("inserted");
  adapter.setAutocompleteProvider?.(autocompleteProvider);
  adapter.setAutocompleteMaxVisible?.(7);
  adapter.setPaddingX?.(3);
  adapter.invalidate();
  const rendered = adapter.render(42);
  extension.baseEditor.onChange?.("changed");
  extension.baseEditor.onSubmit?.("submitted");

  assert.deepEqual(
    {
      autocompleteMaxVisible: extension.baseEditor.autocompleteMaxVisible,
      autocompleteProvider: extension.baseEditor.autocompleteProvider,
      border: adapter.borderColor?.("border"),
      changedText,
      focused: extension.baseEditor.focused,
      history: extension.baseEditor.history,
      insertedText: extension.baseEditor.insertedText,
      invalidations: extension.baseEditor.invalidations,
      padding: extension.baseEditor.padding,
      rendered,
      renderWidths: extension.baseEditor.renderWidths,
      submittedText,
      wantsKeyRelease: adapter.wantsKeyRelease,
    },
    {
      autocompleteMaxVisible: 7,
      autocompleteProvider,
      border: "[border]",
      changedText: "changed",
      focused: true,
      history: ["history"],
      insertedText: ["inserted"],
      invalidations: 1,
      padding: 3,
      rendered: ["draft"],
      renderWidths: [42],
      submittedText: "submitted",
      wantsKeyRelease: true,
    },
  );
});

test("uses a CustomEditor base when no earlier editor factory exists", async () => {
  const extension = loadExtension("", [], { hasExistingEditor: false });
  await startExtension(extension);

  const adapter = extension.getActiveEditor() as EditorComponent & { actionHandlers?: Map<string, () => void> };
  const handler = () => {};
  assert.ok(adapter.actionHandlers instanceof Map);
  adapter.actionHandlers.set("app.clear", handler);

  assert.equal(adapter.actionHandlers.get("app.clear"), handler);
});

test("does not register a global extension shortcut", () => {
  const extension = loadExtension("");

  assert.deepEqual([...extension.shortcuts.keys()], []);
});

test("does not install an editor adapter outside TUI mode", async () => {
  const extension = loadExtension("");
  extension.ctx.mode = "rpc";

  await startExtension(extension);

  assert.equal(extension.getEditorInstallations(), 0);
});

test("the Transfer Shortcut stashes a non-blank Input Draft", async () => {
  const extension = loadExtension("review the current changes");
  await startExtension(extension);

  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), "");
  assert.deepEqual(extension.baseEditor.handledInputs, []);
  assert.equal(extension.entries.length, 1);

  const entry = extension.entries[0];
  assert.ok(entry);
  const { timestamp, ...state } = entry.data as { action: string; prompt: string; timestamp: number };
  assert.equal(typeof timestamp, "number");
  assert.deepEqual(
    { customType: entry.customType, data: state },
    {
      customType: "water-prompt-stash-state",
      data: {
        action: "stash",
        prompt: "review the current changes",
      },
    },
  );
});

test("the Transfer Shortcut restores a stashed Input Draft into a blank editor", async () => {
  const extension = loadExtension("  keep this draft\n");
  await startExtension(extension);

  extension.pressEditor(TRANSFER_KEY_INPUT);
  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), "  keep this draft\n");
  assert.equal(extension.entries.length, 2);

  const entry = extension.entries[1];
  assert.ok(entry);
  const { timestamp, ...state } = entry.data as { action: string; timestamp: number };
  assert.equal(typeof timestamp, "number");
  assert.deepEqual(
    { customType: entry.customType, data: state },
    {
      customType: "water-prompt-stash-state",
      data: {
        action: "clear",
      },
    },
  );
});

test("the Transfer Shortcut treats whitespace-only editor content as blank", async () => {
  const extension = loadExtension("preserve this draft");
  await startExtension(extension);

  extension.pressEditor(TRANSFER_KEY_INPUT);
  extension.setEditorText(" \n\t");
  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), "preserve this draft");
});

test("the Transfer Shortcut restores the branch-local Stash Slot after session start", async () => {
  const extension = loadExtension("", [
    {
      type: "custom",
      customType: "water-prompt-stash-state",
      data: {
        action: "stash",
        prompt: "continue from the saved branch draft",
        timestamp: 1,
      },
    },
  ]);
  await startExtension(extension);
  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), "continue from the saved branch draft");
});

test("stashing a new Input Draft overwrites the occupied Stash Slot", async () => {
  const extension = loadExtension("old draft");
  await startExtension(extension);

  extension.pressEditor(TRANSFER_KEY_INPUT);
  extension.setEditorText("new draft");
  extension.pressEditor(TRANSFER_KEY_INPUT);
  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), "new draft");
});

test("the Transfer Shortcut does nothing when the editor and Stash Slot are blank", async () => {
  const extension = loadExtension(" \n");
  await startExtension(extension);

  extension.pressEditor(TRANSFER_KEY_INPUT);

  assert.equal(extension.getEditorText(), " \n");
  assert.deepEqual(extension.entries, []);
});
