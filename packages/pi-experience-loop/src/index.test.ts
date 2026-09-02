import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import experienceLoopExtension from "./index.ts";

type EventHandler = (event: any, ctx: any) => Promise<any> | any;
type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: any,
  ) => Promise<any>;
};

function loadExtension(learningsDir: string, branch: unknown[] = []) {
  const handlers = new Map<string, EventHandler[]>();
  const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  let saveTool: RegisteredTool | undefined;

  experienceLoopExtension(
    {
      appendEntry(customType: string, data: unknown) {
        entries.push({ type: "custom", customType, data });
      },
      on(eventName: string, handler: EventHandler) {
        const eventHandlers = handlers.get(eventName) ?? [];
        eventHandlers.push(handler);
        handlers.set(eventName, eventHandlers);
      },
      registerTool(tool: RegisteredTool & { name: string }) {
        if (tool.name === "save_learning") saveTool = tool;
      },
    } as any,
    {
      learningsDir,
      now: () => new Date("2026-08-31T10:00:00.000Z"),
    },
  );

  const ctx = {
    cwd: "/project",
    hasUI: true,
    sessionManager: {
      getBranch: () => [...branch, ...entries],
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };

  return {
    ctx,
    entries,
    notifications,
    getHandler(name: string) {
      const handler = handlers.get(name)?.[0];
      assert.ok(handler, `missing ${name} handler`);
      return handler;
    },
    getSaveTool() {
      assert.ok(saveTool, "missing save_learning tool");
      return saveTool;
    },
  };
}

function expandedCapturePrompt(): string {
  const skillPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", "capture-learning", "SKILL.md");
  return `<skill name="capture-learning" location="${skillPath}">\nCapture one durable learning\n</skill>`;
}

async function authorizeCapture(extension: ReturnType<typeof loadExtension>): Promise<void> {
  await extension.getHandler("input")({ source: "interactive", text: "/skill:capture-learning" }, extension.ctx);
  await extension.getHandler("before_agent_start")(
    {
      prompt: expandedCapturePrompt(),
      systemPrompt: "BASE",
    },
    extension.ctx,
  );
  await extension.getHandler("message_end")(
    { message: { role: "user", content: [{ type: "text", text: expandedCapturePrompt() }] } },
    extension.ctx,
  );
}

function assistantWithToolCalls(count: number): unknown {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: Array.from({ length: count }, (_, index) => ({
        type: "toolCall",
        id: `call-${index}`,
        name: index % 2 === 0 ? "read" : "bash",
        arguments: {},
      })),
      stopReason: "stop",
    },
  };
}

test("uses the learning directory configured in pi-water.json", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "water-experience-config-"));
  const handlers = new Map<string, EventHandler>();

  try {
    writeFileSync(
      join(agentDir, "pi-water.json"),
      JSON.stringify({
        version: 1,
        packages: {
          "pi-experience-loop": {
            version: 1,
            learningsDir: "custom-learnings",
          },
        },
      }),
    );
    experienceLoopExtension(
      {
        appendEntry() {},
        on(name: string, handler: EventHandler) {
          handlers.set(name, handler);
        },
        registerTool() {},
      } as any,
      { agentDir },
    );

    const sessionStart = handlers.get("session_start");
    assert.ok(sessionStart);
    await sessionStart(
      {},
      {
        hasUI: true,
        ui: { notify() {} },
      },
    );

    assert.equal(existsSync(join(agentDir, "custom-learnings")), true);
    assert.equal(existsSync(join(agentDir, "learnings")), false);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a saved learning is recalled for a later relevant task", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);

    const result = await extension.getSaveTool().execute(
      "call-1",
      {
        title: "Queue complete file mutations",
        tags: ["typescript", "concurrency", "file-edit"],
        applicability: "Multiple tools may edit the same file concurrently.",
        lesson:
          "Queue the complete read-modify-write window for each target file.\nResolve aliases before selecting the queue.",
        rationale: "Queuing only the final write still permits lost updates.",
        verification: "Run two concurrent edits and confirm both changes remain.",
        limitations: "Read-only operations and different target files do not need the same queue.",
      },
      undefined,
      undefined,
      extension.ctx,
    );

    const files = readdirSync(learningsDir);
    assert.deepEqual(files, ["2026-08-31-queue-complete-file-mutations.md"]);
    assert.equal(
      readFileSync(join(learningsDir, files[0]), "utf8"),
      `---\ntitle: "Queue complete file mutations"\ndate: 2026-08-31\ntags: ["typescript", "concurrency", "file-edit"]\n---\n\n## 适用场景\nMultiple tools may edit the same file concurrently.\n\n## 可复用结论\nQueue the complete read-modify-write window for each target file.\nResolve aliases before selecting the queue.\n\n## 原因\nQueuing only the final write still permits lost updates.\n\n## 验证方式\nRun two concurrent edits and confirm both changes remain.\n\n## 不适用\nRead-only operations and different target files do not need the same queue.\n`,
    );
    assert.match(result.content[0].text, /Saved learning: 2026-08-31-queue-complete-file-mutations/u);

    const recall = await extension.getHandler("before_agent_start")(
      {
        prompt: "Prevent concurrency lost updates with a file mutation queue",
        systemPrompt: "BASE",
      },
      extension.ctx,
    );

    assert.match(recall.systemPrompt, /<experience_recall>/u);
    assert.match(recall.systemPrompt, /Queue complete file mutations/u);
    assert.match(
      recall.systemPrompt,
      /Queue the complete read-modify-write window for each target file\. Resolve aliases before selecting the queue\./u,
    );

    const unrelated = await extension.getHandler("before_agent_start")(
      { prompt: "Polish the product launch announcement", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.equal(unrelated, undefined);

    const queuedPrompt = "Prevent concurrency lost updates with a file mutation queue";
    await extension.getHandler("input")(
      { source: "interactive", streamingBehavior: "followUp", text: queuedPrompt },
      extension.ctx,
    );
    await extension.getHandler("message_end")(
      { message: { role: "user", content: [{ type: "text", text: queuedPrompt }] } },
      extension.ctx,
    );
    const queuedRecall = await extension.getHandler("context")({ messages: [] }, extension.ctx);
    assert.match(queuedRecall.messages[0].content, /Queue complete file mutations/u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("Chinese learning terms are recalled from Chinese tasks", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    await extension.getSaveTool().execute(
      "call-zh",
      {
        title: "并行文件编辑必须共享变更队列",
        tags: ["并发", "文件编辑", "typescript"],
        applicability: "多个工具可能同时编辑同一个文件。",
        lesson: "完整的读取、修改和写入过程必须进入同一个变更队列。",
        rationale: "只排队最终写入仍然会丢失并发更新。",
        verification: "并发执行两个编辑并确认两项变更都保留。",
        limitations: "不同目标文件不需要共享队列。",
      },
      undefined,
      undefined,
      extension.ctx,
    );

    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "修复并发文件编辑导致的更新丢失", systemPrompt: "BASE" },
      extension.ctx,
    );
    assert.match(recall.systemPrompt, /并行文件编辑必须共享变更队列/u);
    assert.match(recall.systemPrompt, /完整的读取、修改和写入过程/u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("concurrent same-title learnings preserve both distinct cards", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const firstExtension = loadExtension(learningsDir);
    const secondExtension = loadExtension(learningsDir);
    await Promise.all([
      firstExtension.getHandler("session_start")({}, firstExtension.ctx),
      secondExtension.getHandler("session_start")({}, secondExtension.ctx),
    ]);
    await Promise.all([authorizeCapture(firstExtension), authorizeCapture(secondExtension)]);
    const firstSaveTool = firstExtension.getSaveTool();
    const secondSaveTool = secondExtension.getSaveTool();
    const baseCard = {
      title: "Queue file mutations",
      tags: ["typescript", "concurrency"],
      applicability: "Multiple tools edit one file.",
      rationale: "Concurrent read-modify-write can lose updates.",
      verification: "Run concurrent edits and inspect the final file.",
      limitations: "Different files do not share a queue.",
    };

    await Promise.all([
      firstSaveTool.execute(
        "call-a",
        { ...baseCard, lesson: "Queue the entire mutation window." },
        undefined,
        undefined,
        firstExtension.ctx,
      ),
      secondSaveTool.execute(
        "call-b",
        { ...baseCard, lesson: "Resolve aliases before selecting a mutation queue." },
        undefined,
        undefined,
        secondExtension.ctx,
      ),
    ]);

    const contents = readdirSync(learningsDir)
      .map((file) => readFileSync(join(learningsDir, file), "utf8"))
      .join("\n--- FILE ---\n");
    assert.equal(readdirSync(learningsDir).length, 2);
    assert.match(contents, /Queue the entire mutation window\./u);
    assert.match(contents, /Resolve aliases before selecting a mutation queue\./u);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("an occupied collision filename is never overwritten", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const card = {
      title: "Collision safe card",
      tags: ["storage", "concurrency"],
      applicability: "A same-title card already exists.",
      lesson: "Choose another filename instead of overwriting unrelated content.",
      rationale: "A short hash can already be occupied or externally tampered with.",
      verification: "Confirm every pre-existing file retains its original bytes.",
      limitations: "Identical card content remains idempotent.",
    };
    const content = `---\ntitle: "Collision safe card"\ndate: 2026-08-31\ntags: ["storage", "concurrency"]\n---\n\n## 适用场景\nA same-title card already exists.\n\n## 可复用结论\nChoose another filename instead of overwriting unrelated content.\n\n## 原因\nA short hash can already be occupied or externally tampered with.\n\n## 验证方式\nConfirm every pre-existing file retains its original bytes.\n\n## 不适用\nIdentical card content remains idempotent.\n`;
    const baseId = "2026-08-31-collision-safe-card";
    const collisionId = `${baseId}-${createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
    writeFileSync(join(learningsDir, `${baseId}.md`), "base sentinel", "utf8");
    writeFileSync(join(learningsDir, `${collisionId}.md`), "collision sentinel", "utf8");

    const extension = loadExtension(learningsDir);
    await extension.getHandler("session_start")({}, extension.ctx);
    await authorizeCapture(extension);
    const result = await extension.getSaveTool().execute("call-collision", card, undefined, undefined, extension.ctx);

    assert.equal(readFileSync(join(learningsDir, `${baseId}.md`), "utf8"), "base sentinel");
    assert.equal(readFileSync(join(learningsDir, `${collisionId}.md`), "utf8"), "collision sentinel");
    assert.equal(readdirSync(learningsDir).length, 3);
    assert.notEqual(result.details.id, baseId);
    assert.notEqual(result.details.id, collisionId);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

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

test("malformed learning files are reported and do not block startup", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    writeFileSync(join(learningsDir, "broken.md"), "# missing frontmatter\n", "utf8");
    writeFileSync(
      join(learningsDir, "missing-sections.md"),
      `---\ntitle: "Missing sections"\ndate: 2026-08-31\ntags: ["broken", "format"]\n---\n\nA free-form body is not a complete learning card.\n`,
      "utf8",
    );
    writeFileSync(
      join(learningsDir, "unsafe-card.md"),
      `---\ntitle: "Unsafe hand-written card"\ndate: 2026-08-31\ntags: ["broken", "security"]\n---\n\n## 适用场景\nA hand-written card bypasses the save tool.\n\n## 可复用结论\nRetain ghp_1234567890abcdef1234 for later.\n\n## 原因\nThe parser must apply the same safety gate.\n\n## 验证方式\nReload the store.\n\n## 不适用\nNever.\n`,
      "utf8",
    );
    writeFileSync(
      join(learningsDir, "missing-date.md"),
      `---\ntitle: "Missing date"\ntags: ["broken", "format"]\n---\n\n## 适用场景\nA malformed hand-written card.\n\n## 可复用结论\nRequire standardized frontmatter.\n\n## 原因\nDates support stable identity and maintenance.\n\n## 验证方式\nReload the store.\n\n## 不适用\nNone.\n`,
      "utf8",
    );
    const extension = loadExtension(learningsDir);

    await extension.getHandler("session_start")({}, extension.ctx);
    const recall = await extension.getHandler("before_agent_start")(
      { prompt: "anything", systemPrompt: "BASE" },
      extension.ctx,
    );

    assert.deepEqual(extension.notifications, [{ level: "warning", message: "Skipped 4 malformed learning files." }]);
    assert.equal(recall, undefined);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("substantive work without enough friction stays silent", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)]);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, []);
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "hinted"),
      false,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("corrections below the substantive-work gate stay silent", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(14)]);
    await extension.getHandler("session_start")({}, extension.ctx);
    await extension.getHandler("input")({ source: "interactive", text: "不对，请换一种实现" }, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, []);
    assert.equal(
      extension.entries.some((entry) => (entry.data as { kind?: string }).kind === "hinted"),
      false,
    );
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});

test("a substantive correction prompts for capture only once on the active branch", async () => {
  const learningsDir = mkdtempSync(join(tmpdir(), "water-learnings-"));

  try {
    const extension = loadExtension(learningsDir, [assistantWithToolCalls(15)]);
    await extension.getHandler("session_start")({}, extension.ctx);

    await extension.getHandler("input")(
      {
        source: "interactive",
        text: "不对，应该把完整的 read-modify-write 放进队列",
      },
      extension.ctx,
    );
    await extension.getHandler("agent_settled")({}, extension.ctx);
    await extension.getHandler("agent_settled")({}, extension.ctx);

    assert.deepEqual(extension.notifications, [
      {
        level: "info",
        message:
          "This branch contained a correction after substantive work. Run /skill:capture-learning to preserve the reusable lesson.",
      },
    ]);
    assert.equal(extension.entries.filter((entry) => (entry.data as { kind?: string }).kind === "hinted").length, 1);
  } finally {
    rmSync(learningsDir, { recursive: true, force: true });
  }
});
