import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AgentSessionIdentity, sessionStatePath } from "./agent-session.ts";

export type SessionFrictionState = {
  correction: number;
  interrupt: number;
  toolCount: number;
  toolError: number;
  toolNames: string[];
};

export type CaptureState = {
  hintedAt?: number;
  learningId?: string;
  savedAt?: number;
};

export type AgentSessionState = {
  version: 1;
  agent: string;
  sessionId: string;
  friction: SessionFrictionState;
  capture: CaptureState;
  updatedAt: number;
};

export type ToolActivitySnapshot = {
  aborted: number;
  toolCount: number;
  toolError: number;
  toolNames: string[];
};

export type SessionStateEvent =
  | { type: "session-started"; at: number }
  | { type: "correction"; at: number }
  | { type: "interrupt"; at: number }
  | { type: "tool-activity"; at: number; activity: ToolActivitySnapshot }
  | { type: "hinted"; at: number }
  | { type: "learning-saved"; at: number; learningId: string };

export class SessionStateValidationError extends Error {}

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 3_000;
const STALE_LOCK_MS = 30_000;

function emptyState(identity: AgentSessionIdentity, now: number): AgentSessionState {
  return {
    version: 1,
    agent: identity.agent,
    sessionId: identity.sessionId,
    friction: {
      correction: 0,
      interrupt: 0,
      toolCount: 0,
      toolError: 0,
      toolNames: [],
    },
    capture: {},
    updatedAt: now,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function optionalTimestamp(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseState(raw: string, identity: AgentSessionIdentity): AgentSessionState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SessionStateValidationError(
      `Session state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionStateValidationError("Session state root must be an object.");
  }

  const state = value as Partial<AgentSessionState>;
  const friction = state.friction as Partial<SessionFrictionState> | undefined;
  const capture = state.capture as Partial<CaptureState> | undefined;
  if (
    !hasOnlyKeys(value, ["version", "agent", "sessionId", "friction", "capture", "updatedAt"]) ||
    state.version !== 1 ||
    state.agent !== identity.agent ||
    state.sessionId !== identity.sessionId ||
    !friction ||
    !hasOnlyKeys(friction, ["correction", "interrupt", "toolCount", "toolError", "toolNames"]) ||
    !isNonNegativeInteger(friction.correction) ||
    !isNonNegativeInteger(friction.interrupt) ||
    !isNonNegativeInteger(friction.toolCount) ||
    !isNonNegativeInteger(friction.toolError) ||
    !Array.isArray(friction.toolNames) ||
    !friction.toolNames.every((name) => typeof name === "string") ||
    new Set(friction.toolNames).size !== friction.toolNames.length ||
    !capture ||
    !hasOnlyKeys(capture, ["hintedAt", "learningId", "savedAt"]) ||
    !optionalTimestamp(capture.hintedAt) ||
    !optionalTimestamp(capture.savedAt) ||
    (capture.learningId !== undefined && typeof capture.learningId !== "string") ||
    typeof state.updatedAt !== "number" ||
    !Number.isFinite(state.updatedAt)
  ) {
    throw new SessionStateValidationError("Session state does not match version 1.");
  }

  return state as AgentSessionState;
}

function applyEvent(state: AgentSessionState, event: SessionStateEvent): AgentSessionState {
  const next: AgentSessionState = {
    ...state,
    friction: { ...state.friction, toolNames: [...state.friction.toolNames] },
    capture: { ...state.capture },
    updatedAt: event.at,
  };

  if (event.type === "correction") next.friction.correction += 1;
  if (event.type === "interrupt") next.friction.interrupt += 1;
  if (event.type === "tool-activity") {
    next.friction.interrupt = Math.max(next.friction.interrupt, event.activity.aborted);
    next.friction.toolCount = event.activity.toolCount;
    next.friction.toolError = event.activity.toolError;
    next.friction.toolNames = [...new Set(event.activity.toolNames)].sort();
  }
  if (event.type === "hinted" && next.capture.hintedAt === undefined) {
    next.capture.hintedAt = event.at;
  }
  if (event.type === "learning-saved") {
    next.capture.learningId = event.learningId;
    next.capture.savedAt = event.at;
  }
  return next;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SessionStateStore {
  readonly path: string;
  readonly #identity: AgentSessionIdentity;

  constructor(projectDir: string, identity: AgentSessionIdentity) {
    this.#identity = identity;
    this.path = sessionStatePath(projectDir, identity);
  }

  async ensure(now = Date.now()): Promise<AgentSessionState> {
    return this.apply({ type: "session-started", at: now });
  }

  async read(): Promise<AgentSessionState> {
    return this.#withLock(async () => this.#readUnlocked(Date.now()));
  }

  async apply(eventOrEvents: SessionStateEvent | readonly SessionStateEvent[]): Promise<AgentSessionState> {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    return this.#withLock(async () => {
      let state = await this.#readUnlocked(events[0]?.at ?? Date.now());
      for (const event of events) state = applyEvent(state, event);
      await this.#writeUnlocked(state);
      return state;
    });
  }

  async #readUnlocked(now: number): Promise<AgentSessionState> {
    try {
      return parseState(await readFile(this.path, "utf8"), this.#identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(this.#identity, now);
      throw error;
    }
  }

  async #writeUnlocked(state: AgentSessionState): Promise<void> {
    parseState(JSON.stringify(state), this.#identity);
    const temporaryPath = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    const startedAt = Date.now();

    for (;;) {
      try {
        await mkdir(lockPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lockStat = await stat(lockPath).catch(() => undefined);
        if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for session state lock: ${this.path}`);
        }
        await delay(LOCK_RETRY_MS);
      }
    }

    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
}
