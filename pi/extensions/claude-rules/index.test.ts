import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import claudeRulesExtension from "./index.ts";

type Handler = (event: any, ctx: any) => any;

test("injects unscoped .claude/rules files into the system prompt", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-claude-rules-"));

  try {
    const rulesDir = join(cwd, ".claude", "rules");
    mkdirSync(join(rulesDir, "frontend"), { recursive: true });

    writeFileSync(join(rulesDir, "general.md"), "# General Rules\n\n- Use pnpm.\n");
    writeFileSync(
      join(rulesDir, "frontend", "react.md"),
      "---\ndescription: React rules\n---\n# React Rules\n\n- Prefer function components.\n",
    );
    writeFileSync(
      join(rulesDir, "api.md"),
      '---\npaths:\n  - "src/api/**/*.ts"\n---\n# API Rules\n\n- Validate inputs.\n',
    );

    const handlers: Record<string, Handler[]> = {};
    claudeRulesExtension({
      on(eventName: string, handler: Handler) {
        handlers[eventName] ??= [];
        handlers[eventName].push(handler);
      },
    } as any);

    const ctx = {
      cwd,
      ui: {
        notify() {},
      },
    };

    assert.equal(handlers.session_start?.length, 1);
    assert.equal(handlers.before_agent_start?.length, 1);

    await handlers.session_start[0]?.({}, ctx);
    const result = await handlers.before_agent_start[0]?.({ systemPrompt: "BASE" }, ctx);

    assert.deepEqual(result, {
      systemPrompt: `BASE

## Project Rules

The following .claude/rules/ files are loaded into this turn. Treat them as project instructions.

Instructions from: .claude/rules/frontend/react.md
<INSTRUCTIONS>
# React Rules

- Prefer function components.
</INSTRUCTIONS>

Instructions from: .claude/rules/general.md
<INSTRUCTIONS>
# General Rules

- Use pnpm.
</INSTRUCTIONS>
`,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
