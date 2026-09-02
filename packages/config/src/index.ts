import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const WATER_CONFIG_FILE_NAME = "pi-water.json";
export const WATER_CONFIG_VERSION = 1;
export const WATER_PROJECT_DIRECTORY_NAME = ".water";

const WATER_PROJECT_GITIGNORE_CONTENT = "*\n";

export type ConfigDiagnostic = {
  message: string;
  path: string;
};

export type ConfigDecodeContext = {
  configDir: string;
  configPath: string;
  resolvePath(value: string): string;
};

export type ConfigSectionResult<T> = {
  value: T;
  configPath: string;
  diagnostics: ConfigDiagnostic[];
};

export type LoadConfigSectionOptions<T> = {
  packageName: string;
  defaults: T;
  decode(value: unknown, context: ConfigDecodeContext): T;
  agentDir?: string;
};

const REPORTED_DIAGNOSTICS_KEY = Symbol.for("water.config.reported-diagnostics");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(path: string, message: string): ConfigDiagnostic {
  return { message: `Invalid Water configuration: ${message}`, path };
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return resolve(homedir(), value.slice(2));
  return value;
}

export function resolveConfigPath(value: string, configDir: string): string {
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(configDir, expanded);
}

export function getWaterConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, WATER_CONFIG_FILE_NAME);
}

export async function ensureWaterProjectDirectory(projectDir: string): Promise<string> {
  const waterDir = join(resolve(projectDir), WATER_PROJECT_DIRECTORY_NAME);
  await mkdir(waterDir, { recursive: true });
  try {
    await writeFile(join(waterDir, ".gitignore"), WATER_PROJECT_GITIGNORE_CONTENT, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return waterDir;
}

export function loadConfigSection<T>(options: LoadConfigSectionOptions<T>): ConfigSectionResult<T> {
  const configPath = getWaterConfigPath(options.agentDir);
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: options.defaults, configPath, diagnostics: [] };
    }
    return {
      value: options.defaults,
      configPath,
      diagnostics: [
        diagnostic(configPath, `cannot read the file (${error instanceof Error ? error.message : String(error)}).`),
      ],
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return {
      value: options.defaults,
      configPath,
      diagnostics: [
        diagnostic(
          configPath,
          `the file is not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
        ),
      ],
    };
  }

  if (!isRecord(document)) {
    return {
      value: options.defaults,
      configPath,
      diagnostics: [diagnostic(configPath, "the root value must be an object.")],
    };
  }
  if (document.version !== WATER_CONFIG_VERSION) {
    return {
      value: options.defaults,
      configPath,
      diagnostics: [diagnostic(configPath, `version must be ${WATER_CONFIG_VERSION}.`)],
    };
  }
  if (!isRecord(document.packages)) {
    return {
      value: options.defaults,
      configPath,
      diagnostics: [diagnostic(configPath, "packages must be an object.")],
    };
  }

  const section = document.packages[options.packageName];
  if (section === undefined) return { value: options.defaults, configPath, diagnostics: [] };

  const configDir = dirname(configPath);
  try {
    return {
      value: options.decode(section, {
        configDir,
        configPath,
        resolvePath: (value) => resolveConfigPath(value, configDir),
      }),
      configPath,
      diagnostics: [],
    };
  } catch (error) {
    return {
      value: options.defaults,
      configPath,
      diagnostics: [
        diagnostic(
          configPath,
          `${options.packageName} is invalid (${error instanceof Error ? error.message : String(error)}).`,
        ),
      ],
    };
  }
}

function reportedDiagnostics(): Set<string> {
  const globalState = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalState[REPORTED_DIAGNOSTICS_KEY];
  if (existing instanceof Set) return existing as Set<string>;

  const created = new Set<string>();
  globalState[REPORTED_DIAGNOSTICS_KEY] = created;
  return created;
}

export function reportConfigDiagnostics(diagnostics: ConfigDiagnostic[], report: (message: string) => void): void {
  const reported = reportedDiagnostics();
  for (const item of diagnostics) {
    const fingerprint = `${item.path}\0${item.message}`;
    if (reported.has(fingerprint)) continue;
    reported.add(fingerprint);
    report(`${item.message} Using package defaults. File: ${item.path}`);
  }
}
