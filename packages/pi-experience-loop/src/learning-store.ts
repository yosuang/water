import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { type LearningCard, parseLearningCard, prepareLearningCard } from "./learning-card.ts";

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

type IndexedLearning = LearningSearchResult & {
  bodyTokens: Set<string>;
  tagTokens: Set<string>;
  titleTokens: Set<string>;
};

type WriteOutcome = "created" | "occupied" | "same";

const MAX_SUMMARY_LENGTH = 280;
const RELEVANCE_THRESHOLD = 4;

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

  const card = parseLearningCard(raw);
  if (!card) return undefined;

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
    const { baseId, content } = prepareLearningCard(rawCard, now);
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
