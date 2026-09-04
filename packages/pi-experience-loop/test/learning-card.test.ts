import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeCapture, loadExtension } from "./support/fake-pi.ts";

test("machine-specific paths are rejected before durable storage", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);

    const saveTool = extension.getSaveTool();
    await assert.rejects(
      saveTool.execute(
        "call-path",
        {
          title: "Do not retain machine paths",
          tags: ["privacy", "workflow"],
          applicability: "A lesson was discovered in a local checkout.",
          lesson: "Read C:\\Users\\alice\\private-repo\\config.json before editing.",
          rationale: "The local file happened to contain the relevant setting.",
          verification: "Check that no durable card is written.",
          limitations: "The path exists only on one machine.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /machine-specific path or raw transcript/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-posix-path",
        {
          title: "Do not retain POSIX machine paths",
          tags: ["privacy", "workflow"],
          applicability: "A lesson mentions a machine-local system file.",
          lesson: "Inspect /etc/passwd before applying the change.",
          rationale: "The path is local context rather than transferable guidance.",
          verification: "Check that no durable card is written.",
          limitations: "Repository-relative paths should be generalized separately.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /machine-specific path or raw transcript/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-home-path",
        {
          title: "Do not retain home-relative machine paths",
          tags: ["privacy", "workflow"],
          applicability: "A lesson mentions a user-local file.",
          lesson: "Inspect ~/private-repo/config before applying the change.",
          rationale: "A home-relative path still belongs to one machine.",
          verification: "Check that no durable card is written.",
          limitations: "Use neutral placeholders for local roots.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /machine-specific path or raw transcript/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-volume-path",
        {
          title: "Do not retain mounted machine paths",
          tags: ["privacy", "workflow"],
          applicability: "A lesson mentions a mounted local volume.",
          lesson: "Inspect /Volumes/private/data before applying the change.",
          rationale: "Mounted roots are machine-specific context.",
          verification: "Check that no durable card is written.",
          limitations: "Repository-relative references should be generalized.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /machine-specific path or raw transcript/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-unlisted-path",
        {
          title: "Do not retain unlisted machine paths",
          tags: ["privacy", "workflow"],
          applicability: "A lesson mentions an uncommon local root.",
          lesson: "Inspect /nix/store/private-package before applying the change.",
          rationale: "A fixed root allowlist cannot cover every machine.",
          verification: "Check that no durable card is written.",
          limitations: "Use neutral placeholders for local roots.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /machine-specific path or raw transcript/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-credential",
        {
          title: "Do not retain credentials",
          tags: ["privacy", "security"],
          applicability: "A session exposed an access token.",
          lesson: "Never retain ghp_1234567890abcdef1234 in a learning card.",
          rationale: "Durable knowledge stores are not secret stores.",
          verification: "Check that no durable card is written.",
          limitations: "Placeholder credential names remain safe to discuss.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /credential or private key/u,
    );
    assert.deepEqual(readdirSync(learningsDir), []);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("transferable slash syntax is allowed in learning prose", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);

    await extension.getSaveTool().execute(
      "call-slash-syntax",
      {
        title: "Preserve transferable slash syntax",
        tags: ["api", "regex", "commands"],
        applicability: "A lesson names routes, slash commands, or regex literals.",
        lesson: "Keep `/api/v1`, `/skill:capture-learning`, and `/foo/u` exact when they are reusable identifiers.",
        rationale: "These constructs are not machine-local filesystem paths.",
        verification: "Save and reload the card without redacting the identifiers.",
        limitations: "Absolute filesystem roots and home-relative paths remain unsafe.",
      },
      undefined,
      undefined,
      extension.ctx,
    );
    assert.equal(readdirSync(learningsDir).length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("level-two headings in card fields are rejected before serialization", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);

    const saveTool = extension.getSaveTool();
    await assert.rejects(
      saveTool.execute(
        "call-heading",
        {
          title: "Keep the card structure valid",
          tags: ["markdown", "validation"],
          applicability: "A generated field contains its own heading.",
          lesson: "## Example\nThis heading would terminate the required section.",
          rationale: "The parser uses level-two headings as structural boundaries.",
          verification: "Reload the saved card and confirm it remains indexable.",
          limitations: "Plain paragraphs and lists remain valid.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /must not contain level-two Markdown headings/u,
    );
    await assert.rejects(
      saveTool.execute(
        "call-limitations",
        {
          title: "Require limitations",
          tags: ["schema", "validation"],
          applicability: "A candidate lesson appears broadly useful.",
          lesson: "Every durable card must state where it does not apply.",
          rationale: "Unbounded guidance is easy to misuse.",
          verification: "Remove limitations and confirm validation rejects the card.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /limitations is required/u,
    );
    assert.deepEqual(readdirSync(learningsDir), []);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
