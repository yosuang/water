import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeCapture, loadExtension } from "./support/fake-pi.ts";

test("saves learnings to .water/learnings in the current session project by default", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-default-"));
  const agentDir = join(rootDir, "agent");
  const projectDir = join(rootDir, "project");

  try {
    const extension = loadExtension(undefined, [], { agentDir, cwd: projectDir });
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    await extension.getSaveTool().execute(
      "call-default-path",
      {
        title: "Keep project learnings local",
        tags: ["storage", "project-scope"],
        applicability: "A session captures reusable guidance for its current project.",
        lesson: "Store the learning with the project that owns its context.",
        rationale: "Project-local storage keeps unrelated project knowledge isolated.",
        verification: "Confirm the learning file appears under the current project's learning directory.",
        limitations: "Use an explicit configured directory when learnings should be shared across projects.",
      },
      undefined,
      undefined,
      extension.ctx,
    );

    const learningsDir = join(projectDir, ".water", "learnings");
    assert.deepEqual(readdirSync(learningsDir), ["2026-08-31-keep-project-learnings-local.md"]);
    assert.equal(readFileSync(join(projectDir, ".water", ".gitignore"), "utf8"), "*\n");
    assert.equal(existsSync(join(agentDir, "learnings")), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("uses the learning directory configured in pi-water.json", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "water-experience-config-"));
  const projectDir = join(agentDir, "project");

  try {
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: {
          "pi-experience-loop": {
            version: 1,
            learningsDir: "custom-learnings",
          },
        },
      }),
    );
    const extension = loadExtension(undefined, [], { agentDir, cwd: projectDir });
    await extension.getHandler("session_start")({}, extension.ctx);

    assert.equal(existsSync(join(agentDir, "custom-learnings")), true);
    assert.equal(readFileSync(join(projectDir, ".water", ".gitignore"), "utf8"), "*\n");
    assert.equal(existsSync(join(projectDir, ".water", "learnings")), false);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("preserves an existing project Water gitignore", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-experience-gitignore-"));
  const agentDir = join(rootDir, "agent");
  const projectDir = join(rootDir, "project");
  const waterDir = join(projectDir, ".water");
  const existing = "# managed by the project\n!.gitkeep\n";

  try {
    mkdirSync(waterDir, { recursive: true });
    writeFileSync(join(waterDir, ".gitignore"), existing, "utf8");
    const extension = loadExtension(undefined, [], { agentDir, cwd: projectDir });
    await extension.getHandler("session_start")({}, extension.ctx);

    assert.equal(readFileSync(join(waterDir, ".gitignore"), "utf8"), existing);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("a saved learning is recalled for a later relevant task", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);

    const result = await extension.getSaveTool().execute(
      "call-1",
      {
        title: "Queue complete file mutations",
        tags: ["typescript", "concurrency", "file-edit"],
        applicability: "Multiple tools may edit the same file concurrently.",
        lesson:
          "Queue the complete read-modify-write window for each target file.\nResolve aliases before selecting the queue.",
        rationale: "Queuing only the final write still permits lost updates.",
        verification: "Run two concurrent edits and confirm both changes remain.",
        limitations: "Read-only operations and different target files do not need the same queue.",
      },
      undefined,
      undefined,
      extension.ctx,
    );

    const files = readdirSync(learningsDir);
    assert.deepEqual(files, ["2026-08-31-queue-complete-file-mutations.md"]);
    assert.equal(
      readFileSync(join(learningsDir, files[0]), "utf8"),
      `---\ntitle: "Queue complete file mutations"\ndate: 2026-08-31\ntags: ["typescript", "concurrency", "file-edit"]\n---\n\n## 适用场景\nMultiple tools may edit the same file concurrently.\n\n## 可复用结论\nQueue the complete read-modify-write window for each target file.\nResolve aliases before selecting the queue.\n\n## 原因\nQueuing only the final write still permits lost updates.\n\n## 验证方式\nRun two concurrent edits and confirm both changes remain.\n\n## 不适用\nRead-only operations and different target files do not need the same queue.\n`,
    );
    assert.match(result.content[0].text, /Saved learning: 2026-08-31-queue-complete-file-mutations/u);

    const recall = await extension.getHandler("before_agent_start")(
      {
        prompt: "Prevent concurrency lost updates with a file mutation queue",
        systemPrompt: "BASE",
      },
      extension.ctx,
    );

    assert.match(recall.systemPrompt, /<experience_recall>/u);
    assert.match(recall.systemPrompt, /Queue complete file mutations/u);
    assert.match(
      recall.systemPrompt,
      /Queue the complete read-modify-write window for each target file\. Resolve aliases before selecting the queue\./u,
    );

    const unrelated = await extension.getHandler("before_agent_start")(
      { prompt: "Polish the product launch announcement", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.equal(unrelated, undefined);

    const queuedPrompt = "Prevent concurrency lost updates with a file mutation queue";
    await extension.getHandler("input")(
      { source: "interactive", streamingBehavior: "followUp", text: queuedPrompt },
      extension.ctx,
    );
    await extension.getHandler("message_end")(
      { message: { role: "user", content: [{ type: "text", text: queuedPrompt }] } },
      extension.ctx,
    );
    const queuedRecall = await extension.getHandler("context")({ messages: [] }, extension.ctx);
    assert.match(queuedRecall.messages[0].content, /Queue complete file mutations/u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
