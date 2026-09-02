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
 * 1. Install the pi-agent-stuff package
 * 2. Create .claude/rules/ in the project root
 * 3. Add .md files with your rules
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scanMarkdownTree, splitFrontmatter } from "@water/shared";

type LoadedRule = {
  relativePath: string;
  content: string;
};

type RuleScanResult = {
  loaded: LoadedRule[];
  skippedPathScoped: string[];
};

function hasPathsFrontmatter(frontmatter: string): boolean {
  return /(?:^|\r?\n)\s*paths\s*:/m.test(frontmatter);
}

function scanRules(rulesDir: string): RuleScanResult {
  const loaded: LoadedRule[] = [];
  const skippedPathScoped: string[] = [];

  for (const file of scanMarkdownTree(rulesDir).files) {
    const { frontmatter, body } = splitFrontmatter(file.content);
    if (hasPathsFrontmatter(frontmatter)) {
      skippedPathScoped.push(file.relativePath);
      continue;
    }

    const content = body.trim();
    if (content.length > 0) loaded.push({ relativePath: file.relativePath, content });
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
    const rulesDir = join(ctx.cwd, ".claude", "rules");
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
