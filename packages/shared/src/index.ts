import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type MarkdownFile = {
  absolutePath: string;
  content: string;
  relativePath: string;
};

export type MarkdownTreeScan = {
  directoryMissing: boolean;
  files: MarkdownFile[];
  unreadablePaths: string[];
};

function discoverMarkdownFiles(dir: string, unreadablePaths: string[], basePath = ""): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    unreadablePaths.push(basePath || ".");
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...discoverMarkdownFiles(join(dir, entry.name), unreadablePaths, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relativePath);
    }
  }
  return results;
}

export function scanMarkdownTree(dir: string): MarkdownTreeScan {
  if (!existsSync(dir)) return { directoryMissing: true, files: [], unreadablePaths: [] };

  const unreadablePaths: string[] = [];
  const relativePaths = discoverMarkdownFiles(dir, unreadablePaths).sort((left, right) => left.localeCompare(right));
  const files: MarkdownFile[] = [];

  for (const relativePath of relativePaths) {
    const absolutePath = resolve(dir, relativePath);
    try {
      files.push({ absolutePath, content: readFileSync(absolutePath, "utf8"), relativePath });
    } catch {
      unreadablePaths.push(relativePath);
    }
  }

  return {
    directoryMissing: false,
    files,
    unreadablePaths: unreadablePaths.sort((left, right) => left.localeCompare(right)),
  };
}

export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[1] ?? "", body: content.slice(match[0].length) };
}
