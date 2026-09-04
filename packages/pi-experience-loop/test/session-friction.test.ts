import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSessionIdentity } from "../src/agent-session.ts";
import { SessionStateStore } from "../src/session-state.ts";
import { assistantWithToolCalls, loadExtension } from "./support/fake-pi.ts";

function setup(mode?: string, sessionId = "friction-session") {
  const rootDir = mkdtempSync(join(tmpdir(), "water-friction-"));
  const projectDir = join(rootDir, "project");
  const branch: unknown[] = [];
  const extension = loadExtension(undefined, branch, {
    agentDir: join(rootDir, "agent"),
    cwd: projectDir,
    ...(mode ? { mode } : {}),
    sessionId,
  });
  return { branch, extension, projectDir, rootDir };
}

test("substantive work without enough friction stays silent", async () => {
  const { branch, extension, rootDir } = setup();
  try {
    await extension.getHandler("session_start")({}, extension.ctx);
    branch.push(assistantWithToolCalls(15));
    await extension.getHandler("agent_settled")({}, extension.ctx);
    assert.deepEqual(extension.notifications, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("a new physical session does not inherit tool friction from its initial branch", async () => {
  const { branch, extension, projectDir, rootDir } = setup("tui", "fork-session");
  try {
    branch.push(assistantWithToolCalls(15));
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    const state = await new SessionStateStore(projectDir, createAgentSessionIdentity("pi", "fork-session")).read();
    assert.equal(state.friction.toolCount, 0);
    assert.deepEqual(extension.widgetUpdates, [{ key: "water-experience-hint", content: undefined }]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("corrections below the substantive-work gate stay silent", async () => {
  const { branch, extension, rootDir } = setup();
  try {
    await extension.getHandler("session_start")({}, extension.ctx);
    branch.push(assistantWithToolCalls(14));
    await extension.getHandler("input")({ source: "interactive", text: "不对，请换一种实现" }, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);
    assert.deepEqual(extension.notifications, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("a substantive correction records one hint in physical session state", async () => {
  const { branch, extension, projectDir, rootDir } = setup();
  try {
    await extension.getHandler("session_start")({}, extension.ctx);
    branch.push(assistantWithToolCalls(15));
    await extension.getHandler("input")(
      { source: "interactive", text: "不对，应该把完整的 read-modify-write 放进队列" },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, [
      {
        level: "info",
        message:
          "This session contained a correction after substantive work. Run /skill:capture-learning to preserve the reusable lesson.",
      },
    ]);
    const state = await new SessionStateStore(projectDir, createAgentSessionIdentity("pi", "friction-session")).read();
    assert.equal(state.friction.correction, 1);
    assert.equal(state.capture.hintedAt, new Date("2026-08-31T10:00:00.000Z").getTime());
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("a TUI widget stays pinned until physical state records a successful save", async () => {
  const { branch, extension, projectDir, rootDir } = setup("tui", "widget-session");
  try {
    await extension.getHandler("session_start")({}, extension.ctx);
    branch.push(assistantWithToolCalls(15));
    await extension.getHandler("input")(
      { source: "interactive", text: "不对，应该把完整的 read-modify-write 放进队列" },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);
    await extension.getHandler("input")({ source: "interactive", text: "继续" }, extension.ctx);

    assert.deepEqual(extension.widgetUpdates, [
      { key: "water-experience-hint", content: undefined },
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
    ]);

    const stateStore = new SessionStateStore(projectDir, createAgentSessionIdentity("pi", "widget-session"));
    await stateStore.apply({
      type: "learning-saved",
      at: Date.now(),
      learningId: "2026-08-31-pinned",
    });
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.widgetUpdates.at(-1), { key: "water-experience-hint", content: undefined });
    assert.deepEqual(extension.appendedEntries, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session start re-pins the widget from physical state", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-friction-restore-"));
  const projectDir = join(rootDir, "project");
  const sessionId = "restore-session";
  try {
    const stateStore = new SessionStateStore(projectDir, createAgentSessionIdentity("pi", sessionId));
    await stateStore.apply([
      { type: "correction", at: 1 },
      {
        type: "tool-activity",
        at: 2,
        activity: { aborted: 0, toolCount: 15, toolError: 0, toolNames: ["read", "bash"] },
      },
      { type: "hinted", at: 3 },
    ]);
    const extension = loadExtension(undefined, [], {
      agentDir: join(rootDir, "agent"),
      cwd: projectDir,
      mode: "tui",
      sessionId,
    });
    await extension.getHandler("session_start")({}, extension.ctx);

    assert.deepEqual(extension.widgetUpdates, [
      {
        key: "water-experience-hint",
        content: ["Capturable experience (a correction): run /skill:capture-learning"],
      },
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session start clears the widget after a physical save", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-friction-saved-"));
  const projectDir = join(rootDir, "project");
  const sessionId = "saved-session";
  try {
    const stateStore = new SessionStateStore(projectDir, createAgentSessionIdentity("pi", sessionId));
    await stateStore.apply([
      { type: "correction", at: 1 },
      {
        type: "tool-activity",
        at: 2,
        activity: { aborted: 0, toolCount: 15, toolError: 0, toolNames: ["read", "bash"] },
      },
      { type: "hinted", at: 3 },
      { type: "learning-saved", at: 4, learningId: "2026-08-31-saved" },
    ]);
    const extension = loadExtension(undefined, [], {
      agentDir: join(rootDir, "agent"),
      cwd: projectDir,
      mode: "tui",
      sessionId,
    });
    await extension.getHandler("session_start")({}, extension.ctx);
    assert.deepEqual(extension.widgetUpdates, [{ key: "water-experience-hint", content: undefined }]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("an RPC hint uses notify without a widget", async () => {
  const { branch, extension, rootDir } = setup("rpc", "rpc-session");
  try {
    await extension.getHandler("session_start")({}, extension.ctx);
    branch.push(assistantWithToolCalls(15));
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
          "This session contained a correction after substantive work. Run /skill:capture-learning to preserve the reusable lesson.",
      },
    ]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
