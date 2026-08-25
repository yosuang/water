import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import addDirExtension from "./index.ts";

type EventHandler = (event: unknown, ctx: any) => Promise<void> | void;
type ArgumentCompleter = (prefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;

type RegisteredCommand = {
  description?: string;
  getArgumentCompletions?: ArgumentCompleter;
};

function loadExtension(branch: unknown[] = []) {
  const handlers = new Map<string, EventHandler[]>();
  let autocompleteProviderFactory: ((current: AutocompleteProvider) => AutocompleteProvider) | undefined;
  let command: RegisteredCommand | undefined;

  addDirExtension({
    on(eventName: string, handler: EventHandler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
    registerCommand(name: string, options: RegisteredCommand) {
      if (name === "add-dir") command = options;
    },
  } as any);

  assert.ok(command?.getArgumentCompletions);

  return {
    command,
    createAutocompleteProvider(current: AutocompleteProvider) {
      assert.ok(autocompleteProviderFactory);
      return autocompleteProviderFactory(current);
    },
    async start() {
      const sessionStart = handlers.get("session_start")?.[0];
      assert.ok(sessionStart);
      await sessionStart(
        {},
        {
          sessionManager: { getBranch: () => branch },
          ui: {
            addAutocompleteProvider(factory: (current: AutocompleteProvider) => AutocompleteProvider) {
              autocompleteProviderFactory = factory;
            },
            setStatus() {},
          },
        },
      );
    },
  };
}

async function complete(command: RegisteredCommand, prefix: string): Promise<AutocompleteItem[] | null> {
  return (await command.getArgumentCompletions?.(prefix)) ?? null;
}

test("keeps adding a directory as the empty-argument primary flow", async () => {
  const extension = loadExtension();
  await extension.start();

  assert.equal(await complete(extension.command, ""), null);
  assert.equal(await complete(extension.command, "../other-project"), null);
  assert.match(extension.command.description ?? "", /type --/u);
});

test("offers management operations only after a dash prefix", async () => {
  const extension = loadExtension();
  await extension.start();

  assert.deepEqual(
    (await complete(extension.command, "-"))?.map(({ value, label }) => ({ value, label })),
    [
      { value: "--list", label: "--list" },
      { value: "--clear", label: "--clear" },
      { value: "--remove ", label: "--remove" },
    ],
  );
  assert.deepEqual(
    (await complete(extension.command, "--c"))?.map(({ value }) => value),
    ["--clear"],
  );
  assert.equal(await complete(extension.command, "--unknown"), null);
});

test("routes an explicit management Tab back to argument completion", async () => {
  const extension = loadExtension();
  await extension.start();
  const delegatedForces: Array<boolean | undefined> = [];
  const current = {
    async getSuggestions(_lines, _cursorLine, _cursorCol, options) {
      delegatedForces.push(options.force);
      return null;
    },
    applyCompletion() {
      throw new Error("not used");
    },
  } satisfies AutocompleteProvider;
  const provider = extension.createAutocompleteProvider(current);
  const input = "/add-dir --remove ";

  await provider.getSuggestions([input], 0, input.length, {
    signal: new AbortController().signal,
    force: true,
  });

  assert.deepEqual(delegatedForces, [false]);
});

test("completes added directories after the remove operation", async () => {
  const extension = loadExtension([
    {
      type: "custom",
      customType: "water-add-dir-state",
      data: { action: "add", path: "C:\\work\\api", timestamp: 1 },
    },
    {
      type: "custom",
      customType: "water-add-dir-state",
      data: { action: "add", path: "C:\\work\\with space", timestamp: 2 },
    },
  ]);
  await extension.start();

  assert.deepEqual(
    (await complete(extension.command, "--remove "))?.map(({ value, label }) => ({ value, label })),
    [
      { value: "--remove C:/work/api", label: "C:/work/api" },
      { value: '--remove "C:/work/with space"', label: "C:/work/with space" },
    ],
  );
  assert.deepEqual(
    (await complete(extension.command, "--remove space"))?.map(({ value }) => value),
    ['--remove "C:/work/with space"'],
  );
});
