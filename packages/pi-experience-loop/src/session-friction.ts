export type ExperienceStateEntry =
  | { kind: "correction"; timestamp: number }
  | { kind: "hinted"; timestamp: number }
  | { kind: "interrupt"; timestamp: number }
  | { kind: "recalled"; ids: string[]; timestamp: number }
  | { kind: "saved"; id: string; timestamp: number };

export type SessionFriction = {
  correction: number;
  hasHinted: boolean;
  hasSaved: boolean;
  interrupt: number;
  score: number;
  toolCount: number;
  toolError: number;
  uniqueTools: number;
};

const CORRECTION_PATTERN =
  /^\s*(?:不对|不是|错了|等等|等一下|别|改成|应该|我的意思是|actually\b|no(?:[,，\s]|$)|wrong\b|that's not\b|instead\b)/iu;

function toolErrorPoints(toolError: number): number {
  if (toolError >= 8) return 25;
  if (toolError >= 5) return 18;
  if (toolError >= 3) return 10;
  return 0;
}

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

export function evaluateSessionFriction(branch: unknown[], stateEntryType: string): SessionFriction {
  let aborted = 0;
  let correction = 0;
  let hasHinted = false;
  let hasSaved = false;
  let interruptMarkers = 0;
  let toolCount = 0;
  let toolError = 0;
  const uniqueTools = new Set<string>();

  for (const entry of branch) {
    if (entry && typeof entry === "object") {
      const custom = entry as { type?: unknown; customType?: unknown; data?: unknown };
      if (
        custom.type === "custom" &&
        custom.customType === stateEntryType &&
        custom.data &&
        typeof custom.data === "object"
      ) {
        const state = custom.data as Partial<ExperienceStateEntry>;
        if (state.kind === "correction") correction += 1;
        if (state.kind === "interrupt") interruptMarkers += 1;
        if (state.kind === "hinted") hasHinted = true;
        if (state.kind === "saved") hasSaved = true;
      }
    }

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
          if (typeof toolCall.name === "string") uniqueTools.add(toolCall.name);
        }
      }
    }
    if (message.role === "toolResult" && message.isError === true) toolError += 1;
  }

  const interrupt = Math.max(aborted, interruptMarkers);
  const diversityBonus =
    toolCount === 0 ? 0 : Math.min(Math.round((uniqueTools.size / Math.min(toolCount, 10)) * 5), 5);
  const score = interrupt * 20 + correction * 20 + toolErrorPoints(toolError) + diversityBonus;
  return {
    correction,
    hasHinted,
    hasSaved,
    interrupt,
    score,
    toolCount,
    toolError,
    uniqueTools: uniqueTools.size,
  };
}

export function frictionReasons(friction: SessionFriction): string[] {
  const reasons: string[] = [];
  if (friction.interrupt > 0) reasons.push("an interruption");
  if (friction.correction > 0) reasons.push("a correction");
  if (friction.toolError >= 3) reasons.push("repeated tool errors");
  return reasons;
}

export function shouldHintForLearning(friction: SessionFriction): boolean {
  return !friction.hasHinted && hasCapturableFriction(friction);
}

/** True while the branch still holds uncaptured friction worth pinning a widget for. */
export function hasCapturableFriction(friction: SessionFriction): boolean {
  return !friction.hasSaved && friction.toolCount >= 15 && friction.score >= 20;
}
