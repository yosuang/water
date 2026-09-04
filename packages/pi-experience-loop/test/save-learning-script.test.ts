import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "capture-learning",
  "scripts",
  "save-learning.ts",
);

const card = {
  title: "Keep project learnings local",
  tags: ["storage", "project-scope"],
  applicability: "A session captures reusable guidance for its current project.",
  lesson: "Store the learning with the project that owns its context.",
  rationale: "Project-local storage keeps unrelated project knowledge isolated.",
  verification: "Confirm the learning file appears under the current project's learning directory.",
  limitations: "Use an explicit configured directory when learnings should be shared across projects.",
};

function runScript(
  projectDir: string,
  agentDir: string,
  sessionId: string,
  input: unknown,
  identityEnv: NodeJS.ProcessEnv = { AI_AGENT: "pi", PI_SESSION_ID: sessionId },
) {
  mkdirSync(projectDir, { recursive: true });
  const cardPath = join(projectDir, "card.json");
  writeFileSync(cardPath, JSON.stringify(input), "utf8");
  return spawnSync("bun", [scriptPath, cardPath], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      AI_AGENT: "",
      PI_CODING_AGENT_DIR: agentDir,
      PI_SESSION_ID: "",
      WATER_AGENT: "",
      WATER_AGENT_DIR: agentDir,
      WATER_SESSION_ID: "",
      ...identityEnv,
    },
  });
}

test("the standalone TypeScript script saves a learning and completes physical session state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-save-script-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  try {
    const result = runScript(projectDir, agentDir, "session-1", card);
    assert.equal(result.status, 0, result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.created, true);
    assert.equal(existsSync(output.path), true);
    assert.equal(output.sessionStatePath, join(projectDir, ".water", "sessions", "pi-session-1.json"));
    const state = JSON.parse(readFileSync(output.sessionStatePath, "utf8"));
    assert.equal(state.capture.learningId, output.id);
    assert.equal(typeof state.capture.savedAt, "number");
    assert.equal(readFileSync(join(projectDir, ".water", ".gitignore"), "utf8"), "*\n");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("the script accepts agent-neutral Water session identity", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-save-neutral-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  try {
    const result = runScript(projectDir, agentDir, "unused", card, {
      WATER_AGENT: "codex",
      WATER_SESSION_ID: "thr_123",
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.sessionStatePath, join(projectDir, ".water", "sessions", "codex-thr_123.json"));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("the script honors the configured learning directory", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-save-config-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  try {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: { "pi-experience-loop": { version: 1, learningsDir: "custom-learnings" } },
      }),
      { encoding: "utf8", flush: true },
    );

    const result = runScript(projectDir, agentDir, "session-2", card);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(dirname(output.path), join(agentDir, "custom-learnings"));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("the script rejects unknown fields without writing a learning or session state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "water-save-invalid-"));
  const projectDir = join(rootDir, "project");
  const agentDir = join(rootDir, "agent");
  try {
    const result = runScript(projectDir, agentDir, "session-3", { ...card, destination: "outside" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown learning field/u);
    assert.equal(existsSync(join(projectDir, ".water", "sessions", "pi-session-3.json")), false);
    assert.deepEqual(
      existsSync(join(projectDir, ".water", "learnings")) ? readdirSync(join(projectDir, ".water", "learnings")) : [],
      [],
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
