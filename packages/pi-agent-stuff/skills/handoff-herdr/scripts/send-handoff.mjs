#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_WINDOWS_PROMPT_CHARS = 24_000;

export function buildPrompt(source, marker) {
  const handoff = source.trim();
  if (!handoff) {
    throw new Error("handoff file is empty");
  }
  if (handoff.includes("\0")) {
    throw new Error("handoff contains a NUL character");
  }

  return `${handoff}\n\n---\nHandoff control:\n- Treat this message as context only.\n- Wait for the user's next instruction before taking action.\n- Reply with exactly: ${marker}`;
}

function runHerdr(args) {
  const command = process.env.HERDR_BIN || "herdr";
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
}

function outputOf(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function requireSuccess(result, operation) {
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${operation} exited with ${result.status}: ${outputOf(result).trim()}`);
  }
}

function parseAgentStatus(output) {
  const payload = JSON.parse(output);
  return payload?.result?.agent?.agent_status;
}

export function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function main() {
  const [agentName, handoffFile, timeoutText = String(DEFAULT_TIMEOUT_MS)] = process.argv.slice(2);
  if (!agentName || !handoffFile) {
    throw new Error("usage: send-handoff.mjs <agent-name> <handoff-file> [timeout-ms]");
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(agentName)) {
    throw new Error(`invalid agent name: ${agentName}`);
  }

  const timeoutMs = Number.parseInt(timeoutText, 10);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid timeout: ${timeoutText}`);
  }

  const marker = `HERDR_HANDOFF_ACCEPTED_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const prompt = buildPrompt(readFileSync(handoffFile, "utf8"), marker);
  if (process.platform === "win32" && prompt.length > MAX_WINDOWS_PROMPT_CHARS) {
    throw new Error(`handoff is too large for a reliable Windows command line (${prompt.length} characters)`);
  }

  const promptResult = runHerdr(["agent", "prompt", agentName, prompt, "--wait", "--timeout", String(timeoutMs)]);
  requireSuccess(promptResult, "herdr agent prompt");

  const readResult = runHerdr(["agent", "read", agentName, "--source", "recent-unwrapped", "--lines", "160"]);
  requireSuccess(readResult, "herdr agent read");
  const markerCount = countOccurrences(outputOf(readResult), marker);
  if (markerCount < 2) {
    throw new Error(`handoff acknowledgment was not observed; marker appeared ${markerCount} time(s)`);
  }

  const getResult = runHerdr(["agent", "get", agentName]);
  requireSuccess(getResult, "herdr agent get");
  const agentStatus = parseAgentStatus(getResult.stdout);
  if (agentStatus !== "idle" && agentStatus !== "done") {
    throw new Error(`agent settled in unexpected state: ${agentStatus || "unknown"}`);
  }

  process.stdout.write(`${JSON.stringify({ agent: agentName, acknowledged: true, marker, status: agentStatus })}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
