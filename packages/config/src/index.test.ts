import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureWaterProjectDirectory, loadConfigSection, reportConfigDiagnostics } from "./index.ts";

function decodeDirectory(value: unknown, context: { resolvePath(value: string): string }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("section must be an object");
  const section = value as Record<string, unknown>;
  if (section.version !== 1) throw new Error("version must be 1");
  if (typeof section.directory !== "string") throw new Error("directory must be a string");
  return { directory: context.resolvePath(section.directory) };
}

test("initializes the project Water directory as Git-ignored local state", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-project-"));
  try {
    const waterDir = await ensureWaterProjectDirectory(projectDir);

    assert.equal(waterDir, join(projectDir, ".water"));
    assert.equal(readFileSync(join(waterDir, ".gitignore"), "utf8"), "*\n");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("preserves an existing project Water gitignore", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "water-project-existing-"));
  const waterDir = join(projectDir, ".water");
  const existing = "# managed by the project\n!.gitkeep\n";
  try {
    mkdirSync(waterDir);
    writeFileSync(join(waterDir, ".gitignore"), existing, "utf8");

    await ensureWaterProjectDirectory(projectDir);

    assert.equal(readFileSync(join(waterDir, ".gitignore"), "utf8"), existing);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("a missing Water config uses package defaults without a diagnostic", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "water-config-missing-"));
  try {
    const defaults = { directory: "/default" };
    const result = loadConfigSection({
      packageName: "pi-example",
      defaults,
      decode: decodeDirectory,
      agentDir,
    });

    assert.equal(result.value, defaults);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a package section is decoded and relative paths resolve from the config directory", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "water-config-valid-"));
  try {
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: {
          "pi-example": { version: 1, directory: "data/example" },
          "pi-other": { version: 1, ignored: true },
        },
      }),
    );

    const result = loadConfigSection({
      packageName: "pi-example",
      defaults: { directory: "/default" },
      decode: decodeDirectory,
      agentDir,
    });

    assert.deepEqual(result.value, { directory: join(agentDir, "data", "example") });
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("an invalid package section falls back without affecting other sections", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "water-config-invalid-section-"));
  try {
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: {
          "pi-broken": { version: 1, directory: 42 },
          "pi-valid": { version: 1, directory: "valid" },
        },
      }),
    );

    const broken = loadConfigSection({
      packageName: "pi-broken",
      defaults: { directory: "/default" },
      decode: decodeDirectory,
      agentDir,
    });
    const valid = loadConfigSection({
      packageName: "pi-valid",
      defaults: { directory: "/default" },
      decode: decodeDirectory,
      agentDir,
    });

    assert.deepEqual(broken.value, { directory: "/default" });
    assert.equal(broken.diagnostics.length, 1);
    assert.deepEqual(valid.value, { directory: join(agentDir, "valid") });
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("the same configuration diagnostic is reported only once per process", () => {
  const messages: string[] = [];
  const uniquePath = join(tmpdir(), `pi-water-${Date.now()}-${Math.random()}.json`);
  const diagnostics = [{ path: uniquePath, message: "broken" }];

  reportConfigDiagnostics(diagnostics, (message) => messages.push(message));
  reportConfigDiagnostics(diagnostics, (message) => messages.push(message));

  assert.deepEqual(messages, [`broken Using package defaults. File: ${uniquePath}`]);
});
