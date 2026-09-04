import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type ToolParameters = ToolDefinition["parameters"];

export const SAVE_LEARNING_PARAMETERS = {
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

export type PreparedLearningCard = {
  baseId: string;
  content: string;
};

const MAX_FIELD_LENGTH = 2_000;
const MAX_TITLE_LENGTH = 100;
const MAX_TAG_LENGTH = 40;
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

function normalizeLearningCard(card: LearningCard): LearningCard {
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
    return line.replace(/^["']|["']$/gu, "");
  }
}

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    body.match(new RegExp(`(?:^|\\r?\\n)## ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`, "u"))?.[1]?.trim() ?? ""
  );
}

export function prepareLearningCard(rawCard: LearningCard, now: Date): PreparedLearningCard {
  const card = normalizeLearningCard(rawCard);
  const date = now.toISOString().slice(0, 10);
  return {
    baseId: `${date}-${slugify(card.title)}`,
    content: serializeLearning(card, date),
  };
}

export function parseLearningCard(raw: string): LearningCard | undefined {
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

  try {
    return normalizeLearningCard({
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
}
