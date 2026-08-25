/**
 * Shared Instructions Extension
 *
 * Loads Markdown files bundled in this package's pi/instructions/ directory
 * and appends their contents to the system prompt.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type LoadedInstruction = {
  relativePath: string;
  content: string;
};

type InstructionScanResult = {
  loaded: LoadedInstruction[];
  unreadablePaths: string[];
  directoryMissing: boolean;
};

type InstructionsExtensionOptions = {
  instructionsDir?: string;
};

const bundledInstructionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "instructions");

function findMarkdownFiles(dir: string, unreadablePaths: string[], basePath = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    unreadablePaths.push(basePath || ".");
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(path.join(dir, entry.name), unreadablePaths, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relativePath);
    }
  }

  return results;
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

function scanInstructions(instructionsDir: string): InstructionScanResult {
  if (!fs.existsSync(instructionsDir)) {
    return { loaded: [], unreadablePaths: [], directoryMissing: true };
  }

  const loaded: LoadedInstruction[] = [];
  const unreadablePaths: string[] = [];
  const instructionFiles = findMarkdownFiles(instructionsDir, unreadablePaths).sort((a, b) => a.localeCompare(b));

  for (const relativePath of instructionFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(instructionsDir, relativePath), "utf8");
    } catch {
      unreadablePaths.push(relativePath);
      continue;
    }

    const content = stripFrontmatter(raw).trim();
    if (content) {
      loaded.push({ relativePath, content });
    }
  }

  return { loaded, unreadablePaths, directoryMissing: false };
}

function formatInstructions(instructions: LoadedInstruction[]): string {
  return instructions
    .map(
      ({ relativePath, content }) =>
        `Instructions from Water extension: ${relativePath}\n<INSTRUCTIONS>\n${content}\n</INSTRUCTIONS>`,
    )
    .join("\n\n");
}

export default function instructionsExtension(pi: ExtensionAPI, options: InstructionsExtensionOptions = {}) {
  const instructionsDir = options.instructionsDir ?? bundledInstructionsDir;
  let instructions: LoadedInstruction[] = [];

  pi.on("session_start", async (_event, ctx) => {
    const result = scanInstructions(instructionsDir);
    instructions = result.loaded;

    if (result.directoryMissing) {
      ctx.ui.notify(`Shared instructions directory not found: ${instructionsDir}`, "warning");
      return;
    }

    if (instructions.length > 0) {
      ctx.ui.notify(`Loaded ${instructions.length} shared instruction(s) from the Water extension`, "info");
    }

    if (result.unreadablePaths.length > 0) {
      ctx.ui.notify(`Skipped ${result.unreadablePaths.length} unreadable path(s) in the Water extension`, "warning");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (instructions.length === 0) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Shared Instructions

The Water extension provides the following shared instructions. Follow them in addition to the existing system instructions.

${formatInstructions(instructions)}
`,
    };
  });
}
