import { join } from "node:path";
import { type ConfigDecodeContext, loadConfigSection, reportConfigDiagnostics } from "@water/config";

const PACKAGE_CONFIG_NAME = "pi-experience-loop";
const PACKAGE_CONFIG_VERSION = 1;

type ExperienceLoopConfig = {
  learningsDir: string;
};

export type ExperienceConfigOptions = {
  agentDir?: string;
  learningsDir?: string;
};

function decodeExperienceLoopConfig(value: unknown, context: ConfigDecodeContext): ExperienceLoopConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("section must be an object");
  const section = value as Record<string, unknown>;
  const unknownKey = Object.keys(section).find((key) => key !== "version" && key !== "learningsDir");
  if (unknownKey) throw new Error(`unknown field: ${unknownKey}`);
  if (section.version !== PACKAGE_CONFIG_VERSION) throw new Error(`version must be ${PACKAGE_CONFIG_VERSION}`);
  if (typeof section.learningsDir !== "string" || section.learningsDir.trim().length === 0) {
    throw new Error("learningsDir must be a non-empty string");
  }
  return { learningsDir: context.resolvePath(section.learningsDir) };
}

export function resolveLearningsDir(
  cwd: string,
  options: ExperienceConfigOptions,
  reportDiagnostic: (message: string) => void,
): string {
  const defaultLearningsDir = join(cwd, ".water", "learnings");
  if (options.learningsDir !== undefined) return options.learningsDir;

  const config = loadConfigSection({
    packageName: PACKAGE_CONFIG_NAME,
    defaults: { learningsDir: defaultLearningsDir },
    decode: decodeExperienceLoopConfig,
    agentDir: options.agentDir,
  });
  reportConfigDiagnostics(config.diagnostics, reportDiagnostic);
  return config.value.learningsDir;
}
