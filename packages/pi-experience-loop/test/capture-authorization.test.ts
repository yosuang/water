import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeCapture, expandedCapturePrompt, loadExtension } from "./support/fake-pi.ts";

test("an unexpanded capture-learning command does not authorize a save", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("input")({ source: "interactive", text: "/skill:capture-learning" }, extension.ctx);
    await extension.getHandler("before_agent_start")(
      { prompt: "/skill:capture-learning", systemPrompt: "BASE" },
      extension.ctx,
    );

    await assert.rejects(
      extension.getSaveTool().execute(
        "call-1",
        {
          title: "Do not save implicitly",
          tags: ["safety", "workflow"],
          applicability: "An agent notices a possible lesson during ordinary work.",
          lesson: "Durable learning writes require an explicit user invocation.",
          rationale: "Session context is not authorization for future writes.",
          verification: "Confirm the learning directory remains unchanged.",
        },
        undefined,
        undefined,
        extension.ctx,
      ),
      /Run \/skill:capture-learning before saving a durable learning\./u,
    );
    assert.deepEqual(readdirSync(learningsDir), []);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("an expanded capture-learning command queued during streaming authorizes one save", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("input")(
      { source: "interactive", streamingBehavior: "steer", text: "/skill:capture-learning" },
      extension.ctx,
    );
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "interrupt"),
      true,
    );
    await extension.getHandler("input")(
      { source: "interactive", streamingBehavior: "followUp", text: "Finish the current explanation first" },
      extension.ctx,
    );
    await extension.getHandler("message_end")(
      { message: { role: "user", content: [{ type: "text", text: "Finish the current explanation first" }] } },
      extension.ctx,
    );
    await extension.getHandler("message_end")(
      {
        message: {
          role: "user",
          content: [{ type: "text", text: expandedCapturePrompt() }],
        },
      },
      extension.ctx,
    );

    await extension.getSaveTool().execute(
      "call-queued",
      {
        title: "Queued capture authorization",
        tags: ["authorization", "streaming"],
        applicability: "A capture skill is queued while the agent is running.",
        lesson: "Verify the expanded queued skill before authorizing its durable write.",
        rationale: "Queued prompts do not pass through before_agent_start.",
        verification: "Confirm one card is saved from the queued capture turn.",
        limitations: "Unexpanded queued commands remain unauthorized.",
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

test("one capture invocation authorizes only one concurrent save", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    const saveTool = extension.getSaveTool();
    const baseCard = {
      tags: ["authorization", "workflow"],
      applicability: "A capture turn attempts parallel durable writes.",
      rationale: "One user invocation grants one durable mutation.",
      verification: "Count the files created by one capture turn.",
      limitations: "A later explicit invocation can save another card.",
    };

    const results = await Promise.allSettled([
      saveTool.execute(
        "call-a",
        { ...baseCard, title: "First authorized card", lesson: "Consume authorization before writing." },
        undefined,
        undefined,
        extension.ctx,
      ),
      saveTool.execute(
        "call-b",
        { ...baseCard, title: "Second unauthorized card", lesson: "This write must be rejected." },
        undefined,
        undefined,
        extension.ctx,
      ),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(readdirSync(learningsDir).length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
