import { join, resolve } from "node:path";

export type AgentSessionIdentity = {
  agent: string;
  sessionId: string;
};

export class AgentSessionIdentityError extends Error {}

const AGENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function createAgentSessionIdentity(agent: string, sessionId: string): AgentSessionIdentity {
  const normalizedAgent = agent.trim().toLowerCase();
  const normalizedSessionId = sessionId.trim();
  if (!AGENT_PATTERN.test(normalizedAgent)) {
    throw new AgentSessionIdentityError(`Invalid agent name: ${agent}`);
  }
  if (!SESSION_ID_PATTERN.test(normalizedSessionId)) {
    throw new AgentSessionIdentityError(`Invalid session id: ${sessionId}`);
  }
  return { agent: normalizedAgent, sessionId: normalizedSessionId };
}

export function resolveAgentSessionIdentity(env: NodeJS.ProcessEnv = process.env): AgentSessionIdentity {
  const waterAgent = env.WATER_AGENT?.trim();
  const waterSessionId = env.WATER_SESSION_ID?.trim();
  if (waterAgent || waterSessionId) {
    if (!waterAgent || !waterSessionId) {
      throw new AgentSessionIdentityError("WATER_AGENT and WATER_SESSION_ID must be set together.");
    }
    return createAgentSessionIdentity(waterAgent, waterSessionId);
  }

  const piSessionId = env.PI_SESSION_ID?.trim();
  if (piSessionId) {
    return createAgentSessionIdentity(env.AI_AGENT?.trim() || "pi", piSessionId);
  }

  throw new AgentSessionIdentityError("Agent session identity is unavailable. Set WATER_AGENT and WATER_SESSION_ID.");
}

export function sessionStatePath(projectDir: string, identity: AgentSessionIdentity): string {
  return join(resolve(projectDir), ".water", "sessions", `${identity.agent}-${identity.sessionId}.json`);
}
