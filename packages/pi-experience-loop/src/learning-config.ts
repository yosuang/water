import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const CONFIG_FILE_NAME = "pi-water.json";
const CONFIG_VERSION = 1;
const PACKAGE_CONFIG_NAME = "pi-experience-loop";
const PACKAGE_CONFIG_VERSION = 1;
const REPORTED_DIAGNOSTICS_KEY = Symbol.for("water.experience-loop.reported-config-diagnostics");

export type LearningConfigOptions = {
  agentDir?: string;
  learningsDir?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return resolve(homedir(), value.slice(2));
  return value;
}

function reportedDiagnostics(): Set<string> {
  const globalState = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalState[REPORTED_DIAGNOSTICS_KEY];
  if (existing instanceof Set) return existing as Set<string>;
  const created = new Set<string>();
  globalState[REPORTED_DIAGNOSTICS_KEY] = created;
  return created;
}

function reportOnce(path: string, detail: string, report: (message: string) => void): void {
  const message = `Invalid Water configuration: ${detail} Using package defaults. File: ${path}`;
  const fingerprint = `${path}\0${message}`;
  const reported = reportedDiagnostics();
  if (reported.has(fingerprint)) return;
  reported.add(fingerprint);
  report(message);
}

export function resolveLearningsDir(
  cwd: string,
  options: LearningConfigOptions,
  reportDiagnostic: (message: string) => void,
): string {
  const defaultLearningsDir = join(cwd, ".water", "learnings");
  if (options.learningsDir !== undefined) return options.learningsDir;
  if (!options.agentDir) return defaultLearningsDir;

  const configPath = join(options.agentDir, CONFIG_FILE_NAME);
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultLearningsDir;
    const detail =
      error instanceof SyntaxError
        ? `the file is not valid JSON (${error.message}).`
        : `cannot read the file (${error instanceof Error ? error.message : String(error)}).`;
    reportOnce(configPath, detail, reportDiagnostic);
    return defaultLearningsDir;
  }

  if (!isRecord(document)) {
    reportOnce(configPath, "the root value must be an object.", reportDiagnostic);
    return defaultLearningsDir;
  }
  if (document.version !== CONFIG_VERSION) {
    reportOnce(configPath, `version must be ${CONFIG_VERSION}.`, reportDiagnostic);
    return defaultLearningsDir;
  }
  if (!isRecord(document.packages)) {
    reportOnce(configPath, "packages must be an object.", reportDiagnostic);
    return defaultLearningsDir;
  }

  const section = document.packages[PACKAGE_CONFIG_NAME];
  if (section === undefined) return defaultLearningsDir;
  if (!isRecord(section)) {
    reportOnce(configPath, `${PACKAGE_CONFIG_NAME} is invalid (section must be an object).`, reportDiagnostic);
    return defaultLearningsDir;
  }
  const unknownKey = Object.keys(section).find((key) => key !== "version" && key !== "learningsDir");
  if (unknownKey) {
    reportOnce(configPath, `${PACKAGE_CONFIG_NAME} is invalid (unknown field: ${unknownKey}).`, reportDiagnostic);
    return defaultLearningsDir;
  }
  if (section.version !== PACKAGE_CONFIG_VERSION) {
    reportOnce(
      configPath,
      `${PACKAGE_CONFIG_NAME} is invalid (version must be ${PACKAGE_CONFIG_VERSION}).`,
      reportDiagnostic,
    );
    return defaultLearningsDir;
  }
  if (typeof section.learningsDir !== "string" || section.learningsDir.trim().length === 0) {
    reportOnce(
      configPath,
      `${PACKAGE_CONFIG_NAME} is invalid (learningsDir must be a non-empty string).`,
      reportDiagnostic,
    );
    return defaultLearningsDir;
  }

  const expanded = expandHome(section.learningsDir);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(dirname(configPath), expanded);
}
