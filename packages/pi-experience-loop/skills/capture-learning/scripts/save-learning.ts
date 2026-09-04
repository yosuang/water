#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAgentSessionIdentity } from "../../../src/agent-session.ts";
import { resolveLearningsDir } from "../../../src/learning-config.ts";
import { LearningStore } from "../../../src/learning-store.ts";
import { SessionStateStore } from "../../../src/session-state.ts";
import { ensureWaterProjectDirectory } from "../../../src/water-project.ts";

const MAX_INPUT_BYTES = 24_000;

function resolveAgentDir(agent: string, env: NodeJS.ProcessEnv): string | undefined {
  if (env.WATER_AGENT_DIR?.trim()) return resolve(env.WATER_AGENT_DIR);
  if (agent !== "pi") return undefined;
  return resolve(env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"));
}

async function readCard(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(`Learning card input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Learning card input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function saveLearningFromFile(options: {
  cardPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{ id: string; path: string; created: boolean; sessionStatePath: string }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const identity = resolveAgentSessionIdentity(env);
  await ensureWaterProjectDirectory(cwd);

  const learningsDir = resolveLearningsDir(cwd, { agentDir: resolveAgentDir(identity.agent, env) }, (message) =>
    process.stderr.write(`${message}\n`),
  );
  const saved = await new LearningStore(learningsDir).save(await readCard(resolve(cwd, options.cardPath)), now);
  const sessionState = new SessionStateStore(cwd, identity);
  await sessionState.apply({ type: "learning-saved", at: now.getTime(), learningId: saved.id });

  return { ...saved, sessionStatePath: sessionState.path };
}

async function main(): Promise<void> {
  const [cardPath, ...extra] = process.argv.slice(2);
  if (!cardPath || extra.length > 0) {
    throw new Error("usage: save-learning.ts <card-json-file>");
  }
  const result = await saveLearningFromFile({ cardPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
