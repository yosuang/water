import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LearningStore } from "../src/learning-store.ts";
import { loadExtension } from "./support/fake-pi.ts";

const now = new Date("2026-08-31T10:00:00.000Z");
const card = {
  title: "Queue complete file mutations",
  tags: ["typescript", "concurrency", "file-edit"],
  applicability: "Multiple tools may edit the same file concurrently.",
  lesson:
    "Queue the complete read-modify-write window for each target file. Resolve aliases before selecting the queue.",
  rationale: "Queuing only the final write still permits lost updates.",
  verification: "Run two concurrent edits and confirm both changes remain.",
  limitations: "Read-only operations and different target files do not need the same queue.",
};

test("session start creates physical state without Pi entries, renderers, or custom tools", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-session-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  try {
    const extension = loadExtension(undefined, [], {
      agentDir,
      cwd: projectDir,
      mode: "tui",
      sessionId: "session-1",
    });
    await extension.getHandler("session_start")({}, extension.ctx);

    assert.equal(existsSync(join(projectDir, ".water", "sessions", "pi-session-1.json")), true);
    assert.equal(readFileSync(join(projectDir, ".water", ".gitignore"), "utf8"), "*\n");
    assert.deepEqual(extension.appendedEntries, []);
    assert.deepEqual(extension.entryRenderers, []);
    assert.deepEqual(extension.registeredTools, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("uses the learning directory configured in pi-water.json", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-config-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  const learningsDir = join(agentDir, "custom-learnings");
  try {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: { "pi-experience-loop": { version: 1, learningsDir: "custom-learnings" } },
      }),
    );
    await new LearningStore(learningsDir).save(card, now);

    const extension = loadExtension(undefined, [], { agentDir, cwd: projectDir, sessionId: "session-2" });
    await extension.getHandler("session_start")({}, extension.ctx);
    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "Prevent concurrency lost updates with a file mutation queue", systemPrompt: "BASE" },
      extension.ctx,
    );

    assert.match(recall.systemPrompt, /Queue complete file mutations/u);
    assert.equal(existsSync(join(projectDir, ".water", "learnings")), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("preserves an existing project Water gitignore", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-gitignore-"));
  const projectDir = join(rootDir, "project");
  const waterDir = join(projectDir, ".water");
  const existing = "# managed by the project\n!.gitkeep\n";
  try {
    mkdirSync(waterDir, { recursive: true });
    writeFileSync(join(waterDir, ".gitignore"), existing, "utf8");
    const extension = loadExtension(undefined, [], {
      agentDir: join(rootDir, "agent"),
      cwd: projectDir,
      sessionId: "session-3",
    });
    await extension.getHandler("session_start")({}, extension.ctx);
    assert.equal(readFileSync(join(waterDir, ".gitignore"), "utf8"), existing);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("recalls a learning written after session start without reloading the extension", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-recall-"));
  const projectDir = join(rootDir, "project");
  const learningsDir = join(projectDir, ".water", "learnings");
  try {
    const extension = loadExtension(undefined, [], {
      agentDir: join(rootDir, "agent"),
      cwd: projectDir,
      sessionId: "session-4",
    });
    await extension.getHandler("session_start")({}, extension.ctx);
    await new LearningStore(learningsDir).save(card, now);

    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "Prevent concurrency lost updates with a file mutation queue", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.match(recall.systemPrompt, /<experience_recall>/u);
    assert.match(recall.systemPrompt, /Queue complete file mutations/u);

    const unrelated = await extension.getHandler("before_agent_start")(
      { prompt: "Polish the product launch announcement", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.equal(unrelated, undefined);

    const capture = await extension.getHandler("before_agent_start")(
      {
        prompt: '<skill name="capture-learning" location="/skill/SKILL.md">\nCapture one durable lesson\n</skill>',
        systemPrompt: "BASE",
      },
      extension.ctx,
    );
    assert.equal(capture, undefined);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("queues recall context for a follow-up prompt", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-queued-"));
  const projectDir = join(rootDir, "project");
  try {
    await new LearningStore(join(projectDir, ".water", "learnings")).save(card, now);
    const extension = loadExtension(undefined, [], {
      agentDir: join(rootDir, "agent"),
      cwd: projectDir,
      sessionId: "session-5",
    });
    await extension.getHandler("session_start")({}, extension.ctx);
    const prompt = "Prevent concurrency lost updates with a file mutation queue";
    await extension.getHandler("message_end")(
      { message: { role: "user", content: [{ type: "text", text: prompt }] } },
      extension.ctx,
    );
    const queued = await extension.getHandler("context")({ messages: [] }, extension.ctx);
    assert.match(queued.messages[0].content, /Queue complete file mutations/u);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
