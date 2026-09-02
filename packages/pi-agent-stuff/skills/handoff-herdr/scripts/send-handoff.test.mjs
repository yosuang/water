import assert from "node:assert/strict";
import test from "node:test";

import { buildPrompt, countOccurrences } from "./send-handoff.mjs";

test("buildPrompt preserves shell metacharacters and Unicode literally", () => {
  const source = [
    "# Handoff",
    "",
    "`new Thread(() => work()).start()`",
    "$(touch should-not-run)",
    "quotes: \"double\" and 'single'",
    "路径：C:\\Users\\测试\\repo",
  ].join("\n");
  const marker = "HERDR_HANDOFF_ACCEPTED_test1234";

  const prompt = buildPrompt(source, marker);

  assert.ok(prompt.startsWith(source));
  assert.equal(countOccurrences(prompt, "$(touch should-not-run)"), 1);
  assert.equal(countOccurrences(prompt, "`new Thread(() => work()).start()`"), 1);
  assert.equal(countOccurrences(prompt, marker), 1);
});

test("buildPrompt rejects empty and NUL-containing payloads", () => {
  assert.throws(() => buildPrompt("   ", "marker"), /empty/);
  assert.throws(() => buildPrompt("bad\0payload", "marker"), /NUL/);
});
