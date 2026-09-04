import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assistantWithToolCalls, authorizeCapture, loadExtension } from "./support/fake-pi.ts";

test("substantive work without enough friction stays silent", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)]);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, []);
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "hinted"),
      false,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("corrections below the substantive-work gate stay silent", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(14)]);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("input")({ source: "interactive", text: "不对，请换一种实现" }, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, []);
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "hinted"),
      false,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("a substantive correction prompts for capture only once on the active branch", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)]);
    await extension.getHandler("session_start")({}, extension.ctx);

    await extension.getHandler("input")(
      {
        source: "interactive",
        text: "不对，应该把完整的 read-modify-write 放进队列",
      },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, [
      {
        level: "info",
        message:
          "This branch contained a correction after substantive work. Run /skill:capture-learning to preserve the reusable lesson.",
      },
    ]);
    assert.equal(extension.entries.filter((entry) => (entry.data as { kind?: string }).kind === "hinted").length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

const identityTheme = {
  bg: (_color: string, text: string) => text,
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function hintEntryData(): unknown {
  return {
    friction: {
      correction: 1,
      hasHinted: true,
      hasSaved: false,
      interrupt: 0,
      score: 21,
      toolCount: 15,
      toolError: 0,
      uniqueTools: 2,
    },
  };
}

test("a TUI hint renders as a transcript card plus a widget pinned until the learning is saved", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)], { mode: "tui" });
    await extension.getHandler("session_start")({}, extension.ctx);

    await extension.getHandler("input")(
      { source: "interactive", text: "不对，应该把完整的 read-modify-write 放进队列" },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, []);
    assert.deepEqual(extension.widgetUpdates, [
      { key: "water-experience-hint", content: undefined },
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
    ]);

    const hintEntries = extension.entries.filter((entry) => entry.customType === "water-experience-hint");
    assert.equal(hintEntries.length, 1);
    const friction = (hintEntries[0].data as { friction: { correction: number; toolCount: number; score: number } })
      .friction;
    assert.equal(friction.correction, 1);
    assert.equal(friction.toolCount, 15);
    assert.equal(friction.score, 21);

    await extension.getHandler("input")({ source: "interactive", text: "继续" }, extension.ctx);
    assert.deepEqual(extension.widgetUpdates, [
      { key: "water-experience-hint", content: undefined },
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
    ]);

    await authorizeCapture(extension);
    await extension.getSaveTool().execute(
      "call-widget-pin",
      {
        title: "Pin the capture widget until saved",
        tags: ["workflow", "ux"],
        applicability: "A friction hint appears while the user's task is still running.",
        lesson: "Keep the capture widget pinned until the learning is actually saved.",
        rationale: "The user often cannot act on the reminder before finishing the current task.",
        verification: "Send another user input and confirm the widget remains visible.",
        limitations: "A saved learning takes the widget down immediately.",
      },
      undefined,
      undefined,
      extension.ctx,
    );
    assert.deepEqual(extension.widgetUpdates, [
      { key: "water-experience-hint", content: undefined },
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
      { key: "water-experience-hint", content: undefined },
    ]);
    assert.equal(extension.entries.filter((entry) => entry.customType === "water-experience-hint").length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("session_start re-pins the widget for a restored branch with uncaptured friction", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const branch = [
      assistantWithToolCalls(15),
      { type: "custom", customType: "water-experience-loop-state", data: { kind: "correction", timestamp: 1 } },
      { type: "custom", customType: "water-experience-loop-state", data: { kind: "hinted", timestamp: 2 } },
    ];
    const extension = loadExtension(learningsDir, branch, { mode: "tui" });
    await extension.getHandler("session_start")({}, extension.ctx);

    assert.deepEqual(extension.widgetUpdates, [
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
    ]);
    assert.deepEqual(extension.notifications, []);
    // Re-pinning restores only the widget; it must not duplicate hint entries or re-notify.
    assert.equal(extension.entries.filter((entry) => entry.customType === "water-experience-hint").length, 0);
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "hinted"),
      false,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("session_start clears a leftover widget when the friction is saved or below the gate", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const savedBranch = [
      assistantWithToolCalls(15),
      { type: "custom", customType: "water-experience-loop-state", data: { kind: "correction", timestamp: 1 } },
      { type: "custom", customType: "water-experience-loop-state", data: { kind: "hinted", timestamp: 2 } },
      {
        type: "custom",
        customType: "water-experience-loop-state",
        data: { kind: "saved", id: "2026-08-31-pinned", timestamp: 3 },
      },
    ];
    const savedExtension = loadExtension(learningsDir, savedBranch, { mode: "tui" });
    await savedExtension.getHandler("session_start")({}, savedExtension.ctx);
    assert.deepEqual(savedExtension.widgetUpdates, [{ key: "water-experience-hint", content: undefined }]);

    const quietExtension = loadExtension(learningsDir, [assistantWithToolCalls(15)], { mode: "tui" });
    await quietExtension.getHandler("session_start")({}, quietExtension.ctx);
    assert.deepEqual(quietExtension.widgetUpdates, [{ key: "water-experience-hint", content: undefined }]);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("the hint entry renderer draws the capture card with expandable details", () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    const renderer = extension.entryRenderers.get("water-experience-hint");
    assert.ok(renderer, "missing water-experience-hint renderer");
    const entry = { type: "custom", customType: "water-experience-hint", data: hintEntryData() };

    const collapsed = renderer(entry, { expanded: false }, identityTheme);
    const collapsedText = collapsed.render(120).join("\n");
    assert.match(collapsedText, /Experience worth capturing/u);
    assert.match(collapsedText, /This branch contained a correction after substantive work\./u);
    assert.match(collapsedText, /Run \/skill:capture-learning to preserve the reusable lesson\./u);
    assert.doesNotMatch(collapsedText, /tool calls/u);

    const expanded = renderer(entry, { expanded: true }, identityTheme);
    const expandedText = expanded.render(120).join("\n");
    assert.match(expandedText, /tool calls 15/u);
    assert.match(expandedText, /corrections 1/u);

    assert.equal(
      renderer({ type: "custom", customType: "water-experience-hint" }, { expanded: false }, identityTheme),
      undefined,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("an RPC hint keeps the notify fallback without a widget", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)], { mode: "rpc" });
    await extension.getHandler("session_start")({}, extension.ctx);

    await extension.getHandler("input")(
      { source: "interactive", text: "不对，应该把完整的 read-modify-write 放进队列" },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.widgetUpdates, []);
    assert.deepEqual(extension.notifications, [
      {
        level: "info",
        message:
          "This branch contained a correction after substantive work. Run /skill:capture-learning to preserve the reusable lesson.",
      },
    ]);
    assert.equal(extension.entries.filter((entry) => entry.customType === "water-experience-hint").length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
