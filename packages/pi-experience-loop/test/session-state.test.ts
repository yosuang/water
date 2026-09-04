import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentSessionIdentityError,
  createAgentSessionIdentity,
  resolveAgentSessionIdentity,
  sessionStatePath,
} from "../src/agent-session.ts";
import { SessionStateStore, SessionStateValidationError } from "../src/session-state.ts";

test("resolves canonical Water identity before the Pi fallback", () => {
  assert.deepEqual(
    resolveAgentSessionIdentity({
      WATER_AGENT: "codex",
      WATER_SESSION_ID: "thr_123",
      AI_AGENT: "pi",
      PI_SESSION_ID: "pi-session",
    }),
    { agent: "codex", sessionId: "thr_123" },
  );
  assert.deepEqual(resolveAgentSessionIdentity({ AI_AGENT: "pi", PI_SESSION_ID: "pi-session" }), {
    agent: "pi",
    sessionId: "pi-session",
  });
  assert.throws(() => resolveAgentSessionIdentity({ WATER_AGENT: "codex" }), AgentSessionIdentityError);
});

test("builds a safe project-local state path", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-session-path-"));
  try {
    const identity = createAgentSessionIdentity("Pi", "session-123");
    assert.equal(sessionStatePath(projectDir, identity), join(projectDir, ".water", "sessions", "pi-session-123.json"));
    assert.throws(() => createAgentSessionIdentity("pi", "../escape"), AgentSessionIdentityError);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("persists friction and capture state in one session file", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-session-state-"));
  try {
    const store = new SessionStateStore(projectDir, createAgentSessionIdentity("pi", "session-1"));
    await store.ensure(1);
    await store.apply([
      { type: "correction", at: 2 },
      { type: "interrupt", at: 3 },
      {
        type: "tool-activity",
        at: 4,
        activity: { aborted: 2, toolCount: 15, toolError: 3, toolNames: ["read", "bash", "read"] },
      },
      { type: "hinted", at: 5 },
      { type: "learning-saved", at: 6, learningId: "2026-08-31-example" },
    ]);

    const state = await store.read();
    assert.deepEqual(state.friction, {
      correction: 1,
      interrupt: 2,
      toolCount: 15,
      toolError: 3,
      toolNames: ["bash", "read"],
    });
    assert.deepEqual(state.capture, {
      hintedAt: 5,
      learningId: "2026-08-31-example",
      savedAt: 6,
    });
    assert.equal(JSON.parse(readFileSync(store.path, "utf8")).sessionId, "session-1");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("serializes concurrent updates without losing state", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-session-concurrent-"));
  try {
    const identity = createAgentSessionIdentity("pi", "session-2");
    const first = new SessionStateStore(projectDir, identity);
    const second = new SessionStateStore(projectDir, identity);
    await first.ensure(1);

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? first : second).apply({ type: "correction", at: index + 2 }),
      ),
    );

    assert.equal((await first.read()).friction.correction, 10);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("does not overwrite malformed state", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-session-malformed-"));
  try {
    const store = new SessionStateStore(projectDir, createAgentSessionIdentity("pi", "session-3"));
    await store.ensure(1);
    writeFileSync(store.path, "{broken", "utf8");

    await assert.rejects(store.apply({ type: "correction", at: 2 }), SessionStateValidationError);
    assert.equal(readFileSync(store.path, "utf8"), "{broken");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
