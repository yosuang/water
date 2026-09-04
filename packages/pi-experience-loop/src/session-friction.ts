import type { AgentSessionState } from "./session-state.ts";

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

function toolErrorPoints(toolError: number): number {
  if (toolError >= 8) return 25;
  if (toolError >= 5) return 18;
  if (toolError >= 3) return 10;
  return 0;
}

export function evaluateSessionFriction(state: AgentSessionState): SessionFriction {
  const uniqueTools = new Set(state.friction.toolNames).size;
  const diversityBonus =
    state.friction.toolCount === 0
      ? 0
      : Math.min(Math.round((uniqueTools / Math.min(state.friction.toolCount, 10)) * 5), 5);
  const score =
    state.friction.interrupt * 20 +
    state.friction.correction * 20 +
    toolErrorPoints(state.friction.toolError) +
    diversityBonus;
  return {
    correction: state.friction.correction,
    hasHinted: state.capture.hintedAt !== undefined,
    hasSaved: state.capture.savedAt !== undefined,
    interrupt: state.friction.interrupt,
    score,
    toolCount: state.friction.toolCount,
    toolError: state.friction.toolError,
    uniqueTools,
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

export function hasCapturableFriction(friction: SessionFriction): boolean {
  return !friction.hasSaved && friction.toolCount >= 15 && friction.score >= 20;
}
