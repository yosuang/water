import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LearningStore } from "../src/learning-store.ts";

const now = new Date("2026-08-31T10:00:00.000Z");

function card(lesson: string) {
  return {
    title: "Queue file mutations",
    tags: ["typescript", "concurrency"],
    applicability: "Multiple writers target one learning title.",
    lesson,
    rationale: "Exclusive file creation prevents unrelated content from being overwritten.",
    verification: "Save concurrent cards and inspect every resulting file.",
    limitations: "Different titles use independent paths.",
  };
}

test("search reloads files written outside the current store instance", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));
  try {
    const reader = new LearningStore(learningsDir);
    const writer = new LearningStore(learningsDir);
    await reader.reload();
    await writer.save(
      {
        title: "并行文件编辑必须共享变更队列",
        tags: ["并发", "文件编辑", "typescript"],
        applicability: "多个工具可能同时编辑同一个文件。",
        lesson: "完整的读取、修改和写入过程必须进入同一个变更队列。",
        rationale: "只排队最终写入仍然会丢失并发更新。",
        verification: "并发执行两个编辑并确认两项变更都保留。",
        limitations: "不同目标文件不需要共享队列。",
      },
      now,
    );

    const results = await reader.search("修复并发文件编辑导致的更新丢失");
    assert.equal(results[0]?.title, "并行文件编辑必须共享变更队列");
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("concurrent same-title saves preserve distinct cards", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));
  try {
    await Promise.all([
      new LearningStore(learningsDir).save(card("Queue the entire mutation window."), now),
      new LearningStore(learningsDir).save(card("Resolve aliases before selecting a mutation queue."), now),
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
    const learning = card("Choose another filename instead of overwriting unrelated content.");
    const content = `---\ntitle: "Queue file mutations"\ndate: 2026-08-31\ntags: ["typescript", "concurrency"]\n---\n\n## 适用场景\nMultiple writers target one learning title.\n\n## 可复用结论\nChoose another filename instead of overwriting unrelated content.\n\n## 原因\nExclusive file creation prevents unrelated content from being overwritten.\n\n## 验证方式\nSave concurrent cards and inspect every resulting file.\n\n## 不适用\nDifferent titles use independent paths.\n`;
    const baseId = "2026-08-31-queue-file-mutations";
    const collisionId = `${baseId}-${createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
    writeFileSync(join(learningsDir, `${baseId}.md`), "base sentinel", "utf8");
    writeFileSync(join(learningsDir, `${collisionId}.md`), "collision sentinel", "utf8");

    const result = await new LearningStore(learningsDir).save(learning, now);

    assert.equal(readFileSync(join(learningsDir, `${baseId}.md`), "utf8"), "base sentinel");
    assert.equal(readFileSync(join(learningsDir, `${collisionId}.md`), "utf8"), "collision sentinel");
    assert.notEqual(result.id, baseId);
    assert.notEqual(result.id, collisionId);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("malformed learning files are counted and skipped", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));
  try {
    writeFileSync(join(learningsDir, "broken.md"), "# missing frontmatter\n", "utf8");
    const result = await new LearningStore(learningsDir).reload();
    assert.deepEqual(result, { loaded: 0, skipped: 1 });
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
