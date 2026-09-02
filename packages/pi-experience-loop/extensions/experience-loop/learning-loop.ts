import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type ToolDefinition, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

type ToolParameters = ToolDefinition["parameters"];

export const SaveLearningParams = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title for the reusable learning" },
    tags: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 5,
    },
    applicability: { type: "string", description: "When this learning applies" },
    lesson: { type: "string", description: "The reusable conclusion or rule" },
    rationale: { type: "string", description: "Why the conclusion is correct" },
    verification: { type: "string", description: "How to verify the learning in practice" },
    limitations: { type: "string", description: "When this learning does not apply" },
  },
  required: ["title", "tags", "applicability", "lesson", "rationale", "verification", "limitations"],
  additionalProperties: false,
} as ToolParameters;

export type LearningCard = {
  title: string;
  tags: string[];
  applicability: string;
  lesson: string;
  rationale: string;
  verification: string;
  limitations: string;
};

export type SavedLearning = {
  id: string;
  path: string;
  created: boolean;
};

export type LearningSearchResult = {
  id: string;
  path: string;
  score: number;
  summary: string;
  title: string;
};

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

/** Data persisted in the visible hint entry rendered inside the transcript. */
export type ExperienceHintEntry = {
  friction: SessionFriction;
};

type IndexedLearning = LearningSearchResult & {
  bodyTokens: Set<string>;
  tagTokens: Set<string>;
  titleTokens: Set<string>;
};

const MAX_FIELD_LENGTH = 2_000;
const MAX_TITLE_LENGTH = 100;
const MAX_TAG_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 280;
const RELEVANCE_THRESHOLD = 4;
const CORRECTION_PATTERN =
  /^\s*(?:不对|不是|错了|等等|等一下|别|改成|应该|我的意思是|actually\b|no(?:[,，\s]|$)|wrong\b|that's not\b|instead\b)/iu;
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:sk|xox[baprs])-[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  /(?:https?|ssh):\/\/[^\s/@:]+:[^\s/@]+@/iu,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/iu,
];
const MACHINE_PATH_PATTERNS = [/\b[A-Za-z]:[\\/][^\s]+/u, /(?:^|[\s("'`])~[\\/][^\s]+/mu, /\\\\[^\s\\]+\\[^\s\\]+/u];
const RAW_TRANSCRIPT_PATTERNS = [
  /(?:^|\n)\s*(?:User|Assistant|Tool)\s*:\s+.+/imu,
  /<conversation(?:\s[^>]*)?>/iu,
  /["']role["']\s*:\s*["'](?:user|assistant|toolResult)["']/iu,
];
const UNMARKED_POSIX_PATH = /(?:^|[\s("'])\/(?!\/)[^\s]+/mu;
const REQUIRED_SECTIONS = ["适用场景", "可复用结论", "原因", "验证方式", "不适用"] as const;

export class LearningValidationError extends Error {}

function normalizeField(value: unknown, name: string, maxLength = MAX_FIELD_LENGTH): string {
  if (value === undefined || value === null) throw new LearningValidationError(`${name} is required.`);
  if (typeof value !== "string") throw new LearningValidationError(`${name} must be a string.`);
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  if (!normalized) throw new LearningValidationError(`${name} is required.`);
  if (normalized.length > maxLength) {
    throw new LearningValidationError(`${name} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function normalizeCard(card: LearningCard): LearningCard {
  const tags = Array.isArray(card.tags)
    ? [...new Set(card.tags.map((tag) => normalizeField(tag, "tag", MAX_TAG_LENGTH).toLowerCase()))]
    : [];
  if (tags.length < 2 || tags.length > 5) {
    throw new LearningValidationError("tags must contain 2 to 5 unique values.");
  }

  const normalized: LearningCard = {
    title: normalizeField(card.title, "title", MAX_TITLE_LENGTH),
    tags,
    applicability: normalizeField(card.applicability, "applicability"),
    lesson: normalizeField(card.lesson, "lesson"),
    rationale: normalizeField(card.rationale, "rationale"),
    verification: normalizeField(card.verification, "verification"),
    limitations: normalizeField(card.limitations, "limitations"),
  };

  const durableText = Object.values(normalized).flat().join("\n");
  if (/(?:^|\n)\s*##(?:\s|$)/u.test(durableText)) {
    throw new LearningValidationError("Learning fields must not contain level-two Markdown headings.");
  }
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(durableText))) {
    throw new LearningValidationError("Learning contains material that looks like a credential or private key.");
  }
  const prose = durableText.replace(/`[^`\r\n]+`/gu, "");
  if (
    MACHINE_PATH_PATTERNS.some((pattern) => pattern.test(durableText)) ||
    RAW_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(durableText)) ||
    UNMARKED_POSIX_PATH.test(prose)
  ) {
    throw new LearningValidationError("Learning contains a machine-specific path or raw transcript content.");
  }
  return normalized;
}

function slugify(title: string): string {
  const slug = Array.from(
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, ""),
  )
    .slice(0, 60)
    .join("")
    .replace(/-+$/u, "");
  return slug || "learning";
}

function serializeLearning(card: LearningCard, date: string): string {
  return `---
title: ${JSON.stringify(card.title)}
date: ${date}
tags: [${card.tags.map((tag) => JSON.stringify(tag)).join(", ")}]
---

## 适用场景
${card.applicability}

## 可复用结论
${card.lesson}

## 原因
${card.rationale}

## 验证方式
${card.verification}

## 不适用
${card.limitations}
`;
}

function parseFrontmatterValue(frontmatter: string, key: string): unknown {
  const line = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"))?.[1]?.trim();
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return line.replace(/^['"]|['"]$/gu, "");
  }
}

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    body.match(new RegExp(`(?:^|\\r?\\n)## ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`, "u"))?.[1]?.trim() ?? ""
  );
}

function tokenize(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  const segmenter = new Intl.Segmenter(["zh", "en"], { granularity: "word" });
  for (const item of segmenter.segment(normalized)) {
    if (item.isWordLike && item.segment.length > 1) tokens.add(item.segment);
  }
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match[0].length > 1) tokens.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const chars = Array.from(match[0]);
    for (let index = 0; index < chars.length - 1; index += 1) {
      tokens.add(`${chars[index]}${chars[index + 1]}`);
    }
  }
  return tokens;
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const chars = Array.from(normalized);
  return chars.length <= MAX_SUMMARY_LENGTH ? normalized : `${chars.slice(0, MAX_SUMMARY_LENGTH - 1).join("")}…`;
}

async function parseLearning(path: string): Promise<IndexedLearning | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u);
  if (!match) return undefined;
  const title = parseFrontmatterValue(match[1], "title");
  const date = parseFrontmatterValue(match[1], "date");
  const tags = parseFrontmatterValue(match[1], "tags");
  const dateTimestamp = typeof date === "string" ? Date.parse(`${date}T00:00:00.000Z`) : Number.NaN;
  const validDate =
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
    Number.isFinite(dateTimestamp) &&
    new Date(dateTimestamp).toISOString().slice(0, 10) === date;
  if (
    typeof title !== "string" ||
    !validDate ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string")
  ) {
    return undefined;
  }

  const body = match[2];
  const sections = new Map(REQUIRED_SECTIONS.map((heading) => [heading, section(body, heading)]));
  if (REQUIRED_SECTIONS.some((heading) => !sections.get(heading))) return undefined;

  let card: LearningCard;
  try {
    card = normalizeCard({
      title,
      tags,
      applicability: sections.get("适用场景")!,
      lesson: sections.get("可复用结论")!,
      rationale: sections.get("原因")!,
      verification: sections.get("验证方式")!,
      limitations: sections.get("不适用")!,
    });
  } catch {
    return undefined;
  }

  return {
    id: basename(path, ".md"),
    path,
    score: 0,
    summary: truncateSummary(card.lesson),
    title: card.title,
    titleTokens: tokenize(card.title),
    tagTokens: tokenize(card.tags.join(" ")),
    bodyTokens: tokenize(Object.values(card).flat().join("\n")),
  };
}

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

export function frictionHint(friction: SessionFriction): string {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return `This branch contained ${reason} after substantive work. Run /skill:capture-learning to preserve the reusable lesson.`;
}

export function hintWidgetLines(friction: SessionFriction): string[] {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return [`Capturable experience (${reason}): run /skill:capture-learning`];
}

export function shouldHintForLearning(friction: SessionFriction): boolean {
  return !friction.hasHinted && !friction.hasSaved && friction.toolCount >= 15 && friction.score >= 20;
}

type WriteOutcome = "created" | "occupied" | "same";

async function writeIfAbsentOrSame(path: string, content: string): Promise<WriteOutcome> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const existing = await readFile(path, "utf8").catch(() => undefined);
  return existing === content ? "same" : "occupied";
}

export class LearningStore {
  readonly #learningsDir: string;
  #entries: IndexedLearning[] = [];

  constructor(learningsDir: string) {
    this.#learningsDir = learningsDir;
  }

  async reload(): Promise<{ loaded: number; skipped: number }> {
    await mkdir(this.#learningsDir, { recursive: true });
    const files = (await readdir(this.#learningsDir)).filter((file) => file.endsWith(".md")).sort();
    const entries = await Promise.all(files.map((file) => parseLearning(join(this.#learningsDir, file))));
    this.#entries = entries.filter((entry): entry is IndexedLearning => entry !== undefined);
    return { loaded: this.#entries.length, skipped: files.length - this.#entries.length };
  }

  async save(rawCard: LearningCard, now: Date): Promise<SavedLearning> {
    const card = normalizeCard(rawCard);
    const date = now.toISOString().slice(0, 10);
    const content = serializeLearning(card, date);
    const baseId = `${date}-${slugify(card.title)}`;
    const basePath = join(this.#learningsDir, `${baseId}.md`);

    await mkdir(this.#learningsDir, { recursive: true });
    const baseOutcome = await withFileMutationQueue(basePath, () => writeIfAbsentOrSame(basePath, content));
    if (baseOutcome !== "occupied") {
      await this.reload();
      return { id: baseId, path: basePath, created: baseOutcome === "created" };
    }

    const hashId = `${baseId}-${createHash("sha256").update(content).digest("hex").slice(0, 8)}`;
    for (let attempt = 0; ; attempt += 1) {
      const collisionId = attempt === 0 ? hashId : `${hashId}-${attempt + 1}`;
      const collisionPath = join(this.#learningsDir, `${collisionId}.md`);
      const collisionOutcome = await withFileMutationQueue(collisionPath, () =>
        writeIfAbsentOrSame(collisionPath, content),
      );
      if (collisionOutcome === "occupied") continue;

      await this.reload();
      return { id: collisionId, path: collisionPath, created: collisionOutcome === "created" };
    }
  }

  search(query: string): LearningSearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0 || this.#entries.length === 0) return [];

    const documentFrequency = new Map<string, number>();
    for (const entry of this.#entries) {
      const allTokens = new Set([...entry.titleTokens, ...entry.tagTokens, ...entry.bodyTokens]);
      for (const token of allTokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }

    const results: LearningSearchResult[] = [];
    for (const entry of this.#entries) {
      let score = 0;
      for (const token of queryTokens) {
        const frequency = documentFrequency.get(token) ?? 0;
        const idf = Math.log((this.#entries.length + 1) / (frequency + 1)) + 1;
        if (entry.titleTokens.has(token)) score += 3 * idf;
        if (entry.tagTokens.has(token)) score += 2 * idf;
        if (entry.bodyTokens.has(token)) score += idf;
      }
      if (score >= RELEVANCE_THRESHOLD) {
        results.push({ id: entry.id, path: entry.path, score, summary: entry.summary, title: entry.title });
      }
    }

    return results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).slice(0, 3);
  }
}
