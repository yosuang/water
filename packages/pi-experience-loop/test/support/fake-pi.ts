import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import experienceLoopExtension from "../../src/experience-loop.ts";

export type EventHandler = (event: any, ctx: any) => Promise<any> | any;
export type EntryRendererFn = (entry: any, options: { expanded: boolean }, theme: any) => any;
export type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: any,
  ) => Promise<any>;
};

export type FakeRuntimeOptions = {
  agentDir?: string;
  cwd?: string;
  mode?: string;
};

export function loadExtension(
  learningsDir: string | undefined,
  branch: unknown[] = [],
  runtime: FakeRuntimeOptions = {},
) {
  const handlers = new Map<string, EventHandler[]>();
  const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const widgetUpdates: Array<{ key: string; content: string[] | undefined }> = [];
  const entryRenderers = new Map<string, EntryRendererFn>();
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
      registerEntryRenderer(customType: string, renderer: EntryRendererFn) {
        entryRenderers.set(customType, renderer);
      },
    } as any,
    {
      ...(runtime.agentDir !== undefined ? { agentDir: runtime.agentDir } : {}),
      ...(learningsDir !== undefined ? { learningsDir } : {}),
      now: () => new Date("2026-08-31T10:00:00.000Z"),
    },
  );

  const ctx = {
    cwd: runtime.cwd ?? "/project",
    hasUI: true,
    ...(runtime.mode !== undefined ? { mode: runtime.mode } : {}),
    sessionManager: {
      getBranch: () => [...branch, ...entries],
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setWidget(key: string, content: string[] | undefined) {
        widgetUpdates.push({ key, content });
      },
    },
  };

  return {
    ctx,
    entries,
    entryRenderers,
    notifications,
    widgetUpdates,
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

export function expandedCapturePrompt(): string {
  const skillPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "skills",
    "capture-learning",
    "SKILL.md",
  );
  return `<skill name="capture-learning" location="${skillPath}">\nCapture one durable learning\n</skill>`;
}

export async function authorizeCapture(extension: ReturnType<typeof loadExtension>): Promise<void> {
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

export function assistantWithToolCalls(count: number): unknown {
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
