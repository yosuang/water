/**
 * Shared Instructions Extension
 *
 * Loads Markdown files bundled in this package's instructions/ directory
 * and appends their contents to the system prompt.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ConfigDecodeContext, loadConfigSection, reportConfigDiagnostics } from "@water/config";
import { scanMarkdownTree, splitFrontmatter } from "@water/shared";

type LoadedInstruction = {
  sourcePath: string;
  content: string;
};

type InstructionScanResult = {
  loaded: LoadedInstruction[];
  unreadablePaths: string[];
  directoryMissing: boolean;
};

type InstructionsExtensionOptions = {
  agentDir?: string;
  instructionsDir?: string;
};

type InstructionsConfig = {
  instructionsDir: string;
};

const PACKAGE_CONFIG_NAME = "pi-instructions";
const PACKAGE_CONFIG_VERSION = 1;
const bundledInstructionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "instructions");

function decodeInstructionsConfig(value: unknown, context: ConfigDecodeContext): InstructionsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("section must be an object");
  const section = value as Record<string, unknown>;
  const unknownKey = Object.keys(section).find((key) => key !== "version" && key !== "instructionsDir");
  if (unknownKey) throw new Error(`unknown field: ${unknownKey}`);
  if (section.version !== PACKAGE_CONFIG_VERSION) throw new Error(`version must be ${PACKAGE_CONFIG_VERSION}`);
  if (typeof section.instructionsDir !== "string" || section.instructionsDir.trim().length === 0) {
    throw new Error("instructionsDir must be a non-empty string");
  }
  return { instructionsDir: context.resolvePath(section.instructionsDir) };
}

function scanInstructions(instructionsDir: string): InstructionScanResult {
  const scan = scanMarkdownTree(instructionsDir);
  const loaded = scan.files
    .map((file) => ({ sourcePath: file.absolutePath, content: splitFrontmatter(file.content).body.trim() }))
    .filter((instruction) => instruction.content.length > 0);

  return {
    loaded,
    unreadablePaths: scan.unreadablePaths,
    directoryMissing: scan.directoryMissing,
  };
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatInstructions(instructions: LoadedInstruction[]): string {
  return instructions
    .map(
      ({ sourcePath, content }) =>
        `<personal_instructions source="${escapeXmlAttribute(sourcePath)}">
${content}
</personal_instructions>`,
    )
    .join("\n\n");
}

export default function instructionsExtension(pi: ExtensionAPI, options: InstructionsExtensionOptions = {}) {
  const config = options.instructionsDir
    ? undefined
    : loadConfigSection({
        packageName: PACKAGE_CONFIG_NAME,
        defaults: { instructionsDir: bundledInstructionsDir },
        decode: decodeInstructionsConfig,
        agentDir: options.agentDir,
      });
  const instructionsDir = path.resolve(
    options.instructionsDir ?? config?.value.instructionsDir ?? bundledInstructionsDir,
  );
  let instructions: LoadedInstruction[] = [];

  pi.on("session_start", async (_event, ctx) => {
    if (config) {
      reportConfigDiagnostics(config.diagnostics, (message) => ctx.ui.notify(message, "warning"));
    }
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

<personal_context>

Personal-specific instructions and guidelines:

${formatInstructions(instructions)}

</personal_context>
`,
    };
  });
}
