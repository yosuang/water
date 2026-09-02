import assert from "node:assert/strict";
import test from "node:test";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  CombinedAutocompleteProvider,
  type EditorComponent,
  KeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import herdrSubagentExtension from "./index.ts";

type EventHandler = (event: unknown, ctx: any) => Promise<void> | void;
type ArgumentCompleter = (prefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
type CommandHandler = (args: string, ctx: any) => Promise<void> | void;

type RegisteredCommand = {
  description?: string;
  getArgumentCompletions?: ArgumentCompleter;
  handler: CommandHandler;
};

type FakeModel = {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<string, string | null>>;
};

type FakeEditor = EditorComponent & {
  handledInputs: string[];
};

type LoadOptions = {
  availableModels?: FakeModel[];
  commands?: Array<{ name: string; source: string }>;
  editor?: FakeEditor;
  idle?: boolean;
  mode?: "json" | "print" | "rpc" | "tui";
  scopedModels?: Array<{ model: FakeModel; thinkingLevel?: string }>;
};

const claude = {
  id: "claude-sonnet-4-5",
  name: "Claude Sonnet 4.5",
  provider: "anthropic",
  reasoning: false,
} satisfies FakeModel;

const gpt = {
  id: "gpt-5",
  name: "GPT-5",
  provider: "openai",
  reasoning: true,
  thinkingLevelMap: { max: "max" },
} satisfies FakeModel;

const localReasoning = {
  id: "qwen:32b",
  name: "Qwen 32B",
  provider: "ollama",
  reasoning: true,
} satisfies FakeModel;

function createFakeEditor(initialText: string, tabTransitions: string[]): FakeEditor {
  let text = initialText;
  const transitions = [...tabTransitions];

  return {
    handledInputs: [],
    getText: () => text,
    handleInput(data: string) {
      this.handledInputs.push(data);
      const nextText = transitions.shift();
      if (nextText !== undefined) text = nextText;
    },
    invalidate() {},
    render: () => [text],
    setText(nextText: string) {
      text = nextText;
    },
  };
}

function loadExtension({
  availableModels = [claude, gpt, localReasoning],
  commands = [{ name: "skill:herdr-subagent", source: "skill" }],
  editor,
  idle = true,
  mode = "print",
  scopedModels = [],
}: LoadOptions = {}) {
  const handlers = new Map<string, EventHandler[]>();
  const messages: Array<{ content: string; options: unknown }> = [];
  const notifications: Array<{ level: string; message: string }> = [];
  const setModelCalls: unknown[] = [];
  let autocompleteProviderFactory: ((current: AutocompleteProvider) => AutocompleteProvider) | undefined;
  let installedEditor: EditorComponent | undefined;
  let registeredName: string | undefined;
  let command: RegisteredCommand | undefined;

  herdrSubagentExtension({
    getCommands: () => commands,
    on(eventName: string, handler: EventHandler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
    registerCommand(name: string, options: RegisteredCommand) {
      registeredName = name;
      command = options;
    },
    sendUserMessage(content: string, options: unknown) {
      messages.push({ content, options });
    },
    setModel(model: unknown) {
      setModelCalls.push(model);
      return Promise.resolve(true);
    },
  } as any);

  assert.ok(command?.getArgumentCompletions);

  const ctx = {
    hasUI: true,
    isIdle: () => idle,
    mode,
    modelRegistry: {
      getAvailable: () => availableModels,
    },
    scopedModels,
    ui: {
      addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) {
        autocompleteProviderFactory = factory;
      },
      getEditorComponent: () => (editor ? () => editor : undefined),
      notify(message: string, level: string) {
        notifications.push({ level, message });
      },
      setEditorComponent(factory: (...args: any[]) => EditorComponent) {
        const plain = (text: string) => text;
        installedEditor = factory(
          { requestRender() {}, terminal: { rows: 40 } },
          {
            borderColor: plain,
            selectList: {
              description: plain,
              noMatch: plain,
              scrollInfo: plain,
              selectedPrefix: plain,
              selectedText: plain,
            },
          },
          editor
            ? {
                matches(data: string, action: string) {
                  return data === "TAB" && action === "tui.input.tab";
                },
              }
            : new KeybindingsManager(TUI_KEYBINDINGS),
        );
      },
    },
  };

  return {
    command,
    createAutocompleteProvider(current: AutocompleteProvider) {
      return autocompleteProviderFactory?.(current) ?? current;
    },
    ctx,
    getInstalledEditor: () => installedEditor,
    messages,
    notifications,
    registeredName,
    setModelCalls,
    async start() {
      const sessionStart = handlers.get("session_start")?.[0];
      assert.ok(sessionStart);
      await sessionStart({}, ctx);
    },
  };
}

async function complete(command: RegisteredCommand, prefix: string): Promise<AutocompleteItem[] | null> {
  return (await command.getArgumentCompletions?.(prefix)) ?? null;
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

test("registers the correctly spelled manual command", () => {
  const extension = loadExtension();

  assert.equal(extension.registeredName, "herdr-subagent");
  assert.match(extension.command.description ?? "", /#provider\/model\[:effort\]/u);
});

test("offers available models only while the optional model token is being entered", async () => {
  const extension = loadExtension();
  await extension.start();

  assert.deepEqual(
    (await complete(extension.command, ""))?.map(({ value, label }) => ({ value, label })),
    [
      { value: "", label: "Use Pi default" },
      { value: "#anthropic/claude-sonnet-4-5 ", label: "anthropic/claude-sonnet-4-5" },
      { value: "#ollama/qwen:32b ", label: "ollama/qwen:32b" },
      { value: "#openai/gpt-5 ", label: "openai/gpt-5" },
    ],
  );
  assert.deepEqual(
    (await complete(extension.command, "#gpt"))?.map(({ value }) => value),
    ["#openai/gpt-5 "],
  );
  assert.equal(await complete(extension.command, "review authentication"), null);
});

test("offers supported effort values for a selected reasoning model", async () => {
  const extension = loadExtension();
  await extension.start();

  assert.deepEqual(
    (await complete(extension.command, "#openai/gpt-5 "))?.map(({ value, label }) => ({ value, label })),
    [
      { value: "#openai/gpt-5 ", label: "Use model default" },
      { value: "#openai/gpt-5:off ", label: "off" },
      { value: "#openai/gpt-5:minimal ", label: "minimal" },
      { value: "#openai/gpt-5:low ", label: "low" },
      { value: "#openai/gpt-5:medium ", label: "medium" },
      { value: "#openai/gpt-5:high ", label: "high" },
      { value: "#openai/gpt-5:max ", label: "max" },
    ],
  );
  assert.deepEqual(
    (await complete(extension.command, "#openai/gpt-5 h"))?.map(({ value }) => value),
    ["#openai/gpt-5:high "],
  );
  assert.deepEqual(
    (await complete(extension.command, "#openai/gpt-5:h"))?.map(({ value }) => value),
    ["#openai/gpt-5:high "],
  );
  assert.equal(await complete(extension.command, "#openai/gpt-5 review authentication"), null);
  assert.equal(await complete(extension.command, "#openai/gpt-5:high review authentication"), null);
});

test("keeps @ available for file completion while # triggers model completion", async () => {
  const extension = loadExtension({ editor: createFakeEditor("", []), mode: "tui" });
  await extension.start();
  const delegatedSuggestions = {
    prefix: "@src",
    items: [{ value: "@src/index.ts", label: "index.ts" }],
  };
  let delegated = false;
  const provider = extension.createAutocompleteProvider({
    triggerCharacters: ["@"],
    async getSuggestions() {
      delegated = true;
      return delegatedSuggestions;
    },
    applyCompletion() {
      throw new Error("not used");
    },
  });
  const fileInput = "/herdr-subagent @src";

  const suggestions = await provider.getSuggestions([fileInput], 0, fileInput.length, {
    signal: new AbortController().signal,
  });

  assert.equal(delegated, true);
  assert.deepEqual(suggestions, delegatedSuggestions);
  assert.deepEqual(provider.triggerCharacters, ["@", "#"]);
});

test("applies model and effort completions as a delimiter-free command with single spaces", async () => {
  const extension = loadExtension({ editor: createFakeEditor("", []), mode: "tui" });
  await extension.start();
  const provider = extension.createAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        {
          name: "herdr-subagent",
          description: extension.command.description,
          getArgumentCompletions: extension.command.getArgumentCompletions,
        },
      ],
      process.cwd(),
      null,
    ),
  );
  const signal = new AbortController().signal;
  const initialInput = "/herdr-subagent ";
  const modelSuggestions = await provider.getSuggestions([initialInput], 0, initialInput.length, { signal });
  const defaultModel = modelSuggestions?.items.find((item) => item.label === "Use Pi default");
  const model = modelSuggestions?.items.find((item) => item.label === "openai/gpt-5");
  assert.ok(modelSuggestions && defaultModel && model);
  const withDefaultModel = provider.applyCompletion(
    [initialInput],
    0,
    initialInput.length,
    defaultModel,
    modelSuggestions.prefix,
  );
  assert.equal(withDefaultModel.lines[0], initialInput);

  const typedModelInput = "/herdr-subagent #gpt";
  const typedModelSuggestions = await provider.getSuggestions([typedModelInput], 0, typedModelInput.length, {
    signal,
  });
  assert.deepEqual(
    typedModelSuggestions?.items.map(({ value, label }) => ({ value, label })),
    [{ value: "#openai/gpt-5 ", label: "openai/gpt-5" }],
  );

  const withModel = provider.applyCompletion([initialInput], 0, initialInput.length, model, modelSuggestions.prefix);
  assert.equal(withModel.lines[0], "/herdr-subagent #openai/gpt-5 ");

  const effortSuggestions = await provider.getSuggestions(withModel.lines, 0, withModel.cursorCol, { signal });
  const defaultEffort = effortSuggestions?.items.find((item) => item.label === "Use model default");
  const effort = effortSuggestions?.items.find((item) => item.label === "high");
  assert.ok(effortSuggestions && defaultEffort && effort);
  const withDefaultEffort = provider.applyCompletion(
    withModel.lines,
    0,
    withModel.cursorCol,
    defaultEffort,
    effortSuggestions.prefix,
  );
  assert.equal(withDefaultEffort.lines[0], "/herdr-subagent #openai/gpt-5 ");

  const withEffort = provider.applyCompletion(
    withModel.lines,
    0,
    withModel.cursorCol,
    effort,
    effortSuggestions.prefix,
  );
  assert.equal(withEffort.lines[0], "/herdr-subagent #openai/gpt-5:high ");
});

test("opens model completions after Tab selects the slash command in a real CustomEditor", async () => {
  const extension = loadExtension({ mode: "tui" });
  await extension.start();
  const editor = extension.getInstalledEditor() as EditorComponent & {
    autocompleteList?: { getSelectedItem(): AutocompleteItem | null };
    isShowingAutocomplete(): boolean;
  };
  const provider = extension.createAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        {
          name: "herdr-subagent",
          description: extension.command.description,
          getArgumentCompletions: extension.command.getArgumentCompletions,
        },
      ],
      process.cwd(),
      null,
    ),
  );
  editor.setAutocompleteProvider?.(provider);

  for (const char of "/herd") editor.handleInput(char);
  await waitFor(() => editor.isShowingAutocomplete(), "slash command completions did not open");
  editor.handleInput("\t");
  await waitFor(() => editor.isShowingAutocomplete(), "model completions did not open after command completion");

  assert.equal(editor.getText(), "/herdr-subagent ");
  assert.equal(editor.autocompleteList?.getSelectedItem()?.label, "Use Pi default");
});

test("chains command and reasoning-model Tab completions in TUI mode", async () => {
  for (const { initialText, nextText } of [
    {
      initialText: "/herd",
      nextText: "/herdr-subagent ",
    },
    {
      initialText: "/herdr-subagent ",
      nextText: "/herdr-subagent #openai/gpt-5 ",
    },
  ]) {
    const editor = createFakeEditor(initialText, [nextText]);
    const extension = loadExtension({ editor, mode: "tui" });
    await extension.start();

    extension.getInstalledEditor()?.handleInput("TAB");

    assert.equal(extension.getInstalledEditor()?.getText(), nextText);
    assert.deepEqual(editor.handledInputs, ["TAB", "TAB"]);
  }
});

test("does not chain Tab after a non-reasoning model or outside TUI mode", async () => {
  const editor = createFakeEditor("/herdr-subagent ", ["/herdr-subagent #anthropic/claude-sonnet-4-5 "]);
  const tuiExtension = loadExtension({ editor, mode: "tui" });
  await tuiExtension.start();
  tuiExtension.getInstalledEditor()?.handleInput("TAB");
  assert.deepEqual(editor.handledInputs, ["TAB"]);

  const printEditor = createFakeEditor("/herd", ["/herdr-subagent "]);
  const printExtension = loadExtension({ editor: printEditor, mode: "print" });
  await printExtension.start();
  assert.equal(printExtension.getInstalledEditor(), undefined);
});

test("does not offer effort for a non-reasoning model or a scoped model with pinned effort", async () => {
  const nonReasoning = loadExtension();
  await nonReasoning.start();
  assert.equal(await complete(nonReasoning.command, "#anthropic/claude-sonnet-4-5 "), null);

  const scoped = loadExtension({
    scopedModels: [{ model: gpt, thinkingLevel: "high" }],
  });
  await scoped.start();

  assert.deepEqual(
    (await complete(scoped.command, ""))?.map(({ value }) => value),
    ["", "#openai/gpt-5:high "],
  );
  assert.equal(await complete(scoped.command, "#openai/gpt-5:high "), null);
});

test("preserves model ids containing colons when adding effort", async () => {
  const extension = loadExtension();
  await extension.start();

  assert.deepEqual(
    (await complete(extension.command, "#ollama/qwen:32b h"))?.map(({ value }) => value),
    ["#ollama/qwen:32b:high "],
  );

  await extension.command.handler("#ollama/qwen:32b:high investigate the local model", extension.ctx);

  assert.equal(
    extension.messages[0]?.content,
    "/skill:herdr-subagent Use ollama/qwen:32b:high for every Pi subagent in this run.\n\ninvestigate the local model",
  );
});

test("dispatches a task without a model through the existing skill", async () => {
  const extension = loadExtension();
  await extension.start();

  await extension.command.handler("review authentication", extension.ctx);

  assert.deepEqual(extension.messages, [
    {
      content: "/skill:herdr-subagent review authentication",
      options: { expandPromptTemplates: true },
    },
  ]);
  assert.deepEqual(extension.setModelCalls, []);
});

test("dispatches an explicit child model and optional effort without changing the coordinator", async () => {
  const extension = loadExtension();
  await extension.start();

  await extension.command.handler("#openai/gpt-5 review authentication", extension.ctx);
  await extension.command.handler("#openai/gpt-5:high investigate flaky tests", extension.ctx);

  assert.deepEqual(extension.messages, [
    {
      content: "/skill:herdr-subagent Use openai/gpt-5 for every Pi subagent in this run.\n\nreview authentication",
      options: { expandPromptTemplates: true },
    },
    {
      content:
        "/skill:herdr-subagent Use openai/gpt-5:high for every Pi subagent in this run.\n\ninvestigate flaky tests",
      options: { expandPromptTemplates: true },
    },
  ]);
  assert.deepEqual(extension.setModelCalls, []);
});

test("supports a bare command and model-like task text that is not a known model", async () => {
  const extension = loadExtension();
  await extension.start();

  await extension.command.handler("", extension.ctx);
  await extension.command.handler("@src/auth/index.ts explain this file", extension.ctx);

  assert.deepEqual(extension.messages, [
    {
      content: "/skill:herdr-subagent",
      options: { expandPromptTemplates: true },
    },
    {
      content: "/skill:herdr-subagent @src/auth/index.ts explain this file",
      options: { expandPromptTemplates: true },
    },
  ]);
});

test("rejects unsupported effort for a known model", async () => {
  const extension = loadExtension();
  await extension.start();

  await extension.command.handler("#openai/gpt-5:extreme review authentication", extension.ctx);

  assert.deepEqual(extension.messages, []);
  assert.deepEqual(extension.notifications, [
    {
      level: "warning",
      message: 'Unsupported effort "extreme" for openai/gpt-5.',
    },
  ]);
});

test("fails closed while busy or when the native skill command is unavailable or shadowed", async () => {
  const busy = loadExtension({ idle: false });
  await busy.start();
  await busy.command.handler("review authentication", busy.ctx);
  assert.deepEqual(busy.messages, []);
  assert.match(busy.notifications[0]?.message ?? "", /busy/u);

  for (const commands of [
    [],
    [{ name: "skill:herdr-subagent", source: "extension" }],
    [
      { name: "skill:herdr-subagent", source: "skill" },
      { name: "skill:herdr-subagent", source: "extension" },
    ],
  ]) {
    const extension = loadExtension({ commands });
    await extension.start();
    await extension.command.handler("review authentication", extension.ctx);
    assert.deepEqual(extension.messages, []);
    assert.match(extension.notifications[0]?.message ?? "", /native \/skill:herdr-subagent/u);
  }
});
