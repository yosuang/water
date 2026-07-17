/**
 * Claude Rules Extension
 *
 * Scans the project's .claude/rules/ folder for rule files and injects
 * unscoped rule contents into the system prompt.
 *
 * Note: rules with `paths` frontmatter are intentionally skipped for now.
 * Supporting them correctly requires path-triggered lazy loading when matching
 * files are read or edited.
 *
 * Best practices for .claude/rules/:
 * - Keep rules focused: Each file should cover one topic (e.g., testing.md, api-design.md)
 * - Use descriptive filenames: The filename should indicate what the rules cover
 * - Use conditional rules sparingly: Only add paths frontmatter when rules truly apply to specific file types
 * - Organize with subdirectories: Group related rules (e.g., frontend/, backend/)
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Create .claude/rules/ folder in your project root
 * 3. Add .md files with your rules
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type LoadedRule = {
  relativePath: string;
  content: string;
};

type RuleScanResult = {
  loaded: LoadedRule[];
  skippedPathScoped: string[];
};

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir: string, basePath: string = ""): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(path.join(dir, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relativePath);
    }
  }

  return results;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: "", body: content };
  }

  return {
    frontmatter: match[1] ?? "",
    body: content.slice(match[0].length),
  };
}

function hasPathsFrontmatter(frontmatter: string): boolean {
  return /(?:^|\r?\n)\s*paths\s*:/m.test(frontmatter);
}

function scanRules(rulesDir: string): RuleScanResult {
  const loaded: LoadedRule[] = [];
  const skippedPathScoped: string[] = [];
  const ruleFiles = findMarkdownFiles(rulesDir).sort((a, b) => a.localeCompare(b));

  for (const relativePath of ruleFiles) {
    const absolutePath = path.join(rulesDir, relativePath);

    let raw: string;
    try {
      raw = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    const { frontmatter, body } = splitFrontmatter(raw);
    if (hasPathsFrontmatter(frontmatter)) {
      skippedPathScoped.push(relativePath);
      continue;
    }

    const content = body.trim();
    if (content.length > 0) {
      loaded.push({ relativePath, content });
    }
  }

  return { loaded, skippedPathScoped };
}

function formatRules(rules: LoadedRule[]): string {
  return rules
    .map(
      (rule) =>
        `Instructions from: .claude/rules/${rule.relativePath}\n<INSTRUCTIONS>\n${rule.content}\n</INSTRUCTIONS>`,
    )
    .join("\n\n");
}

export default function claudeRulesExtension(pi: ExtensionAPI) {
  let rules: LoadedRule[] = [];
  let skippedPathScoped: string[] = [];

  // Scan for rules on session start.
  pi.on("session_start", async (_event, ctx) => {
    const rulesDir = path.join(ctx.cwd, ".claude", "rules");
    const result = scanRules(rulesDir);
    rules = result.loaded;
    skippedPathScoped = result.skippedPathScoped;

    if (rules.length > 0) {
      ctx.ui.notify(`Loaded ${rules.length} unscoped rule(s) from .claude/rules/`, "info");
    }

    if (skippedPathScoped.length > 0) {
      ctx.ui.notify(`Skipped ${skippedPathScoped.length} path-scoped rule(s) in .claude/rules/`, "warning");
    }
  });

  // Append unscoped rule contents to system prompt.
  pi.on("before_agent_start", async (event) => {
    if (rules.length === 0) {
      return;
    }

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Project Rules

The following .claude/rules/ files are loaded into this turn. Treat them as project instructions.

${formatRules(rules)}
`,
    };
  });
}
