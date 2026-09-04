import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeCapture, loadExtension } from "./support/fake-pi.ts";

test("Chinese learning terms are recalled from Chinese tasks", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    await extension.getSaveTool().execute(
      "call-zh",
      {
        title: "并行文件编辑必须共享变更队列",
        tags: ["并发", "文件编辑", "typescript"],
        applicability: "多个工具可能同时编辑同一个文件。",
        lesson: "完整的读取、修改和写入过程必须进入同一个变更队列。",
        rationale: "只排队最终写入仍然会丢失并发更新。",
        verification: "并发执行两个编辑并确认两项变更都保留。",
        limitations: "不同目标文件不需要共享队列。",
      },
      undefined,
      undefined,
      extension.ctx,
    );

    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "修复并发文件编辑导致的更新丢失", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.match(recall.systemPrompt, /并行文件编辑必须共享变更队列/u);
    assert.match(recall.systemPrompt, /完整的读取、修改和写入过程/u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("concurrent same-title learnings preserve both distinct cards", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const firstExtension = loadExtension(learningsDir);
    const secondExtension = loadExtension(learningsDir);
    await Promise.all([
      firstExtension.getHandler("session_start")({}, firstExtension.ctx),
      secondExtension.getHandler("session_start")({}, secondExtension.ctx),
    ]);
    await Promise.all([authorizeCapture(firstExtension), authorizeCapture(secondExtension)]);
    const firstSaveTool = firstExtension.getSaveTool();
    const secondSaveTool = secondExtension.getSaveTool();
    const baseCard = {
      title: "Queue file mutations",
      tags: ["typescript", "concurrency"],
      applicability: "Multiple tools edit one file.",
      rationale: "Concurrent read-modify-write can lose updates.",
      verification: "Run concurrent edits and inspect the final file.",
      limitations: "Different files do not share a queue.",
    };

    await Promise.all([
      firstSaveTool.execute(
        "call-a",
        { ...baseCard, lesson: "Queue the entire mutation window." },
        undefined,
        undefined,
        firstExtension.ctx,
      ),
      secondSaveTool.execute(
        "call-b",
        { ...baseCard, lesson: "Resolve aliases before selecting a mutation queue." },
        undefined,
        undefined,
        secondExtension.ctx,
      ),
    ]);

    const contents = readdirSync(learningsDir)
      .map((file) => readFileSync(join(learningsDir, file), "utf8"))
      .join("\n--- FILE ---\n");
    assert.equal(readdirSync(learningsDir).length, 2);
    assert.match(contents, /Queue the entire mutation window\./u);
    assert.match(contents, /Resolve aliases before selecting a mutation queue\./u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("an occupied collision filename is never overwritten", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const card = {
      title: "Collision safe card",
      tags: ["storage", "concurrency"],
      applicability: "A same-title card already exists.",
      lesson: "Choose another filename instead of overwriting unrelated content.",
      rationale: "A short hash can already be occupied or externally tampered with.",
      verification: "Confirm every pre-existing file retains its original bytes.",
      limitations: "Identical card content remains idempotent.",
    };
    const content = `---\ntitle: "Collision safe card"\ndate: 2026-08-31\ntags: ["storage", "concurrency"]\n---\n\n## 适用场景\nA same-title card already exists.\n\n## 可复用结论\nChoose another filename instead of overwriting unrelated content.\n\n## 原因\nA short hash can already be occupied or externally tampered with.\n\n## 验证方式\nConfirm every pre-existing file retains its original bytes.\n\n## 不适用\nIdentical card content remains idempotent.\n`;
    const baseId = "2026-08-31-collision-safe-card";
    const collisionId = `${baseId}-${createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
    writeFileSync(join(learningsDir, `${baseId}.md`), "base sentinel", "utf8");
    writeFileSync(join(learningsDir, `${collisionId}.md`), "collision sentinel", "utf8");

    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    const result = await extension.getSaveTool().execute("call-collision", card, undefined, undefined, extension.ctx);

    assert.equal(readFileSync(join(learningsDir, `${baseId}.md`), "utf8"), "base sentinel");
    assert.equal(readFileSync(join(learningsDir, `${collisionId}.md`), "utf8"), "collision sentinel");
    assert.equal(readdirSync(learningsDir).length, 3);
    assert.notEqual(result.details.id, baseId);
    assert.notEqual(result.details.id, collisionId);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("malformed learning files are reported and do not block startup", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    writeFileSync(join(learningsDir, "broken.md"), "# missing frontmatter\n", "utf8");
    writeFileSync(
      join(learningsDir, "missing-sections.md"),
      `---\ntitle: "Missing sections"\ndate: 2026-08-31\ntags: ["broken", "format"]\n---\n\nA free-form body is not a complete learning card.\n`,
      "utf8",
    );
    writeFileSync(
      join(learningsDir, "unsafe-card.md"),
      `---\ntitle: "Unsafe hand-written card"\ndate: 2026-08-31\ntags: ["broken", "security"]\n---\n\n## 适用场景\nA hand-written card bypasses the save tool.\n\n## 可复用结论\nRetain ghp_1234567890abcdef1234 for later.\n\n## 原因\nThe parser must apply the same safety gate.\n\n## 验证方式\nReload the store.\n\n## 不适用\nNever.\n`,
      "utf8",
    );
    writeFileSync(
      join(learningsDir, "missing-date.md"),
      `---\ntitle: "Missing date"\ntags: ["broken", "format"]\n---\n\n## 适用场景\nA malformed hand-written card.\n\n## 可复用结论\nRequire standardized frontmatter.\n\n## 原因\nDates support stable identity and maintenance.\n\n## 验证方式\nReload the store.\n\n## 不适用\nNone.\n`,
      "utf8",
    );
    const extension = loadExtension(learningsDir);

    await extension.getHandler("session_start")({}, extension.ctx);
    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "anything", systemPrompt: "BASE" },
      extension.ctx,
    );

    assert.deepEqual(extension.notifications, [{ level: "warning", message: "Skipped 4 malformed learning files." }]);
    assert.equal(recall, undefined);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
