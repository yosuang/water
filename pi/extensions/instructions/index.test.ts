import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import instructionsExtension from "./index.ts";

type Handler = (event: any, ctx: any) => any;

test("injects Markdown instructions in relative-path order with absolute source paths", async () => {
  const instructionsDir = mkdtempSync(join(tmpdir(), "pi-instructions-"));

  try {
    mkdirSync(join(instructionsDir, "nested"));
    writeFileSync(join(instructionsDir, "z-last.md"), "# Last\n\n- Last instruction.\n");
    writeFileSync(
      join(instructionsDir, "nested", "first.md"),
      "---\ndescription: metadata only\n---\n# Nested\n\n- Nested instruction.\n",
    );
    writeFileSync(join(instructionsDir, "empty.md"), "---\ndescription: empty\n---\n\n");
    writeFileSync(join(instructionsDir, "ignored.txt"), "Not an instruction.\n");

    const handlers: Record<string, Handler[]> = {};
    instructionsExtension(
      {
        on(eventName: string, handler: Handler) {
          handlers[eventName] ??= [];
          handlers[eventName].push(handler);
        },
      } as any,
      { instructionsDir },
    );

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    };

    await handlers.session_start?.[0]?.({}, ctx);
    const result = await handlers.before_agent_start?.[0]?.({ systemPrompt: "BASE" }, ctx);

    assert.deepEqual(notifications, [
      {
        message: "Loaded 2 shared instruction(s) from the Water extension",
        level: "info",
      },
    ]);
    assert.deepEqual(result, {
      systemPrompt: `BASE

<personal_context>

Personal-specific instructions and guidelines:

<personal_instructions source="${join(instructionsDir, "nested", "first.md")}">
# Nested

- Nested instruction.
</personal_instructions>

<personal_instructions source="${join(instructionsDir, "z-last.md")}">
# Last

- Last instruction.
</personal_instructions>

</personal_context>
`,
    });
  } finally {
    rmSync(instructionsDir, { recursive: true, force: true });
  }
});

test("warns and skips injection when the instructions directory is missing", async () => {
  const parentDir = mkdtempSync(join(tmpdir(), "pi-instructions-missing-"));
  const instructionsDir = join(parentDir, "missing");

  try {
    const handlers: Record<string, Handler[]> = {};
    instructionsExtension(
      {
        on(eventName: string, handler: Handler) {
          handlers[eventName] ??= [];
          handlers[eventName].push(handler);
        },
      } as any,
      { instructionsDir },
    );

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    };

    await handlers.session_start?.[0]?.({}, ctx);
    const result = await handlers.before_agent_start?.[0]?.({ systemPrompt: "BASE" }, ctx);

    assert.deepEqual(notifications, [
      {
        message: `Shared instructions directory not found: ${instructionsDir}`,
        level: "warning",
      },
    ]);
    assert.equal(result, undefined);
  } finally {
    rmSync(parentDir, { recursive: true, force: true });
  }
});
