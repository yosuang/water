import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanMarkdownTree, splitFrontmatter } from "./index.ts";

test("scanMarkdownTree returns readable Markdown files in relative-path order", () => {
  const root = mkdtempSync(join(tmpdir(), "water-markdown-tree-"));
  try {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "z.md"), "z");
    writeFileSync(join(root, "nested", "a.md"), "a");
    writeFileSync(join(root, "ignored.txt"), "ignored");

    const result = scanMarkdownTree(root);

    assert.equal(result.directoryMissing, false);
    assert.deepEqual(
      result.files.map(({ relativePath, content }) => ({ relativePath, content })),
      [
        { relativePath: "nested/a.md", content: "a" },
        { relativePath: "z.md", content: "z" },
      ],
    );
    assert.deepEqual(result.unreadablePaths, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanMarkdownTree distinguishes a missing directory", () => {
  const root = join(tmpdir(), `water-markdown-missing-${Date.now()}-${Math.random()}`);
  assert.deepEqual(scanMarkdownTree(root), {
    directoryMissing: true,
    files: [],
    unreadablePaths: [],
  });
});

test("splitFrontmatter preserves the body and returns metadata separately", () => {
  assert.deepEqual(splitFrontmatter("---\npaths: src/**\n---\n# Rule\n"), {
    frontmatter: "paths: src/**",
    body: "# Rule\n",
  });
  assert.deepEqual(splitFrontmatter("# Rule\n"), {
    frontmatter: "",
    body: "# Rule\n",
  });
});
