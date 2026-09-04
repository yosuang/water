import assert from "node:assert/strict";
import { dirname } from "node:path";
import { createExperienceLoopExtension } from "../../src/experience-loop.ts";

export type EventHandler = (event: any, ctx: any) => Promise<any> | any;

export type FakeRuntimeOptions = {
  agentDir?: string;
  cwd?: string;
  mode?: string;
  sessionId?: string;
};

export function loadExtension(
  learningsDir: string | undefined,
  branch: unknown[] = [],
  runtime: FakeRuntimeOptions = {},
) {
  const handlers = new Map<string, EventHandler[]>();
  const notifications: Array<{ message: string; level: string }> = [];
  const widgetUpdates: Array<{ key: string; content: string[] | undefined }> = [];
  const registeredTools: string[] = [];
  const appendedEntries: string[] = [];
  const entryRenderers: string[] = [];

  const factory = createExperienceLoopExtension({
    ...(runtime.agentDir !== undefined ? { agentDir: runtime.agentDir } : {}),
    ...(learningsDir !== undefined ? { learningsDir } : {}),
    now: () => new Date("2026-08-31T10:00:00.000Z"),
  });
  factory({
    appendEntry(customType: string) {
      appendedEntries.push(customType);
    },
    on(eventName: string, handler: EventHandler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
    registerTool(tool: { name: string }) {
      registeredTools.push(tool.name);
    },
    registerEntryRenderer(customType: string) {
      entryRenderers.push(customType);
    },
  } as any);

  const cwd = runtime.cwd ?? (learningsDir ? dirname(learningsDir) : "/project");
  const ctx = {
    cwd,
    hasUI: true,
    ...(runtime.mode !== undefined ? { mode: runtime.mode } : {}),
    sessionManager: {
      getBranch: () => [...branch],
      getSessionId: () => runtime.sessionId ?? "test-session",
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
    appendedEntries,
    ctx,
    entryRenderers,
    notifications,
    registeredTools,
    widgetUpdates,
    getHandler(name: string) {
      const handler = handlers.get(name)?.[0];
      assert.ok(handler, `missing ${name} handler`);
      return handler;
    },
  };
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
