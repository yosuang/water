import { resolve } from "node:path";

const CAPTURE_COMMAND_PATTERN = /^\/skill:capture-learning(?:\s|$)/u;

function normalizedPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export class CaptureAuthorization {
  readonly #captureSkillPath: string;
  #availableGrants = 0;
  #pendingRequests = 0;

  constructor(captureSkillPath: string) {
    this.#captureSkillPath = normalizedPath(captureSkillPath);
  }

  reset(): void {
    this.#availableGrants = 0;
    this.#pendingRequests = 0;
  }

  observeInput(text: string): boolean {
    if (!CAPTURE_COMMAND_PATTERN.test(text.trim())) return false;
    this.#pendingRequests += 1;
    return true;
  }

  observeExpandedPrompt(prompt: string): boolean {
    if (this.#pendingRequests === 0 || !this.#isCaptureAttempt(prompt)) return false;
    this.#pendingRequests -= 1;
    if (this.#isBundledCaptureSkillPrompt(prompt)) this.#availableGrants += 1;
    return true;
  }

  clearAfterAgentSettled(): boolean {
    if (this.#pendingRequests === 0 && this.#availableGrants === 0) return false;
    this.reset();
    return true;
  }

  consumeGrant(): void {
    if (this.#availableGrants === 0) {
      throw new Error("Run /skill:capture-learning before saving a durable learning.");
    }
    this.#availableGrants -= 1;
  }

  restoreGrant(): void {
    this.#availableGrants += 1;
  }

  #isCaptureAttempt(prompt: string): boolean {
    return this.#isBundledCaptureSkillPrompt(prompt) || CAPTURE_COMMAND_PATTERN.test(prompt.trim());
  }

  #isBundledCaptureSkillPrompt(prompt: string): boolean {
    const location = prompt.match(/^<skill name="capture-learning" location="([^"]+)">/u)?.[1];
    return location !== undefined && normalizedPath(location) === this.#captureSkillPath;
  }
}
