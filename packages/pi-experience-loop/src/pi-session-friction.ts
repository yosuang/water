import type { ToolActivitySnapshot } from "./session-state.ts";

const CORRECTION_PATTERN =
  /^\s*(?:不对|不是|错了|等等|等一下|别|改成|应该|我的意思是|actually\b|no(?:[,，\s]|$)|wrong\b|that's not\b|instead\b)/iu;

function isMessageEntry(entry: unknown): entry is {
  type: "message";
  message: {
    content?: unknown;
    isError?: boolean;
    role?: string;
    stopReason?: string;
  };
} {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as { type?: unknown; message?: unknown };
  return candidate.type === "message" && !!candidate.message && typeof candidate.message === "object";
}

export function hasAssistantResponse(branch: unknown[]): boolean {
  return branch.some((entry) => isMessageEntry(entry) && entry.message.role === "assistant");
}

export function isCorrectionPrompt(text: string): boolean {
  return CORRECTION_PATTERN.test(text);
}

export function measurePiToolActivity(branch: unknown[]): ToolActivitySnapshot {
  let aborted = 0;
  let toolCount = 0;
  let toolError = 0;
  const toolNames = new Set<string>();

  for (const entry of branch) {
    if (!isMessageEntry(entry)) continue;
    const message = entry.message;
    if (message.role === "assistant") {
      if (message.stopReason === "aborted") aborted += 1;
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!block || typeof block !== "object") continue;
          const toolCall = block as { type?: unknown; name?: unknown };
          if (toolCall.type !== "toolCall") continue;
          toolCount += 1;
          if (typeof toolCall.name === "string") toolNames.add(toolCall.name);
        }
      }
    }
    if (message.role === "toolResult" && message.isError === true) toolError += 1;
  }

  return { aborted, toolCount, toolError, toolNames: [...toolNames] };
}
