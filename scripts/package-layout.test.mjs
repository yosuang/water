import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const rootDir = resolve(import.meta.dirname, "..");
const rootManifest = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const packageNames = ["pi-agent-stuff", "pi-experience-loop", "pi-herdr-subagent", "pi-instructions"];

function manifestFor(packageName) {
  const packageDir = join(rootDir, "packages", packageName);
  return {
    packageDir,
    manifest: JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")),
  };
}

function assertResourcePaths(packageDir, manifest) {
  for (const resourceType of ["extensions", "skills", "prompts", "themes"]) {
    for (const resourcePath of manifest.pi?.[resourceType] ?? []) {
      assert.equal(
        existsSync(resolve(packageDir, resourcePath)),
        true,
        `${manifest.name} has a missing ${resourceType} path: ${resourcePath}`,
      );
    }
  }
}

test("the root and four public Pi package manifests expose existing resources", () => {
  assert.deepEqual(
    rootManifest.workspaces,
    ["packages/*"],
    "the workspace package glob is the monorepo ownership seam",
  );
  assertResourcePaths(rootDir, rootManifest);

  for (const packageName of packageNames) {
    const { packageDir, manifest } = manifestFor(packageName);
    assert.ok(manifest.keywords?.includes("pi-package"), `${packageName} must be discoverable as a Pi package`);
    assertResourcePaths(packageDir, manifest);
  }
});

test("workspace dependency versions stay npm-installable and consistent", () => {
  const manifests = [rootManifest, ...["config", "shared", ...packageNames].map((name) => manifestFor(name).manifest)];
  const pinnedCoreVersions = new Map();

  for (const manifest of manifests) {
    for (const dependencyType of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, version] of Object.entries(manifest[dependencyType] ?? {})) {
        assert.notEqual(
          version,
          "catalog:",
          `${manifest.name} ${dependencyName} must not use Bun's catalog: protocol; Pi installs git packages with npm`,
        );
        if (dependencyName.startsWith("@water/")) {
          assert.equal(
            version,
            "*",
            `${manifest.name} ${dependencyName} must reference the workspace package with "*"`,
          );
        }
        if (dependencyName.startsWith("@earendil-works/") && dependencyType === "peerDependencies") {
          assert.equal(version, "*", `${manifest.name} ${dependencyName} must stay "*" so Pi bundles the core package`);
        }
        if (dependencyName.startsWith("@earendil-works/") && dependencyType !== "peerDependencies") {
          const previous = pinnedCoreVersions.get(dependencyName);
          if (previous) {
            assert.equal(
              version,
              previous,
              `${dependencyName} is ${version} in ${manifest.name} but ${previous} elsewhere`,
            );
          }
          pinnedCoreVersions.set(dependencyName, version);
        }
      }
    }
  }
});

test("every extension entry point is importable from its package", async () => {
  const entryPoints = [
    ...["add-dir", "claude-rules", "continue", "prompt-stash"].map((name) =>
      join(rootDir, "packages", "pi-agent-stuff", "extensions", name, "index.ts"),
    ),
    join(rootDir, "packages", "pi-experience-loop", "src", "index.ts"),
    join(rootDir, "packages", "pi-herdr-subagent", "src", "index.ts"),
    join(rootDir, "packages", "pi-instructions", "src", "index.ts"),
  ];

  for (const entryPoint of entryPoints) {
    const extension = await import(pathToFileURL(entryPoint).href);
    assert.equal(typeof extension.default, "function", `${entryPoint} must default-export an extension factory`);
  }
});
