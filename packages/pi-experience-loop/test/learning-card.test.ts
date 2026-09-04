import assert from "node:assert/strict";
import test from "node:test";
import { LearningValidationError, parseLearningCard, prepareLearningCard } from "../src/learning-card.ts";

const now = new Date("2026-08-31T10:00:00.000Z");
const card = {
  title: "Queue complete file mutations",
  tags: ["typescript", "concurrency", "file-edit"],
  applicability: "Multiple tools may edit the same file concurrently.",
  lesson: "Queue the complete read-modify-write window for each target file.",
  rationale: "Queuing only the final write still permits lost updates.",
  verification: "Run two concurrent edits and confirm both changes remain.",
  limitations: "Read-only operations and different target files do not need the same queue.",
};

test("prepares and parses the canonical learning document", () => {
  const prepared = prepareLearningCard(card, now);

  assert.equal(prepared.baseId, "2026-08-31-queue-complete-file-mutations");
  assert.equal(parseLearningCard(prepared.content)?.lesson, card.lesson);
  assert.match(prepared.content, /date: 2026-08-31/u);
  assert.match(prepared.content, /## 不适用/u);
});

test("rejects machine-specific paths, transcripts, and credentials", () => {
  const unsafeLessons = [
    "Read C:\\Users\\alice\\private-repo\\config.json before editing.",
    "Inspect /etc/passwd before applying the change.",
    "Inspect ~/private-repo/config before applying the change.",
    "Inspect /Volumes/private/data before applying the change.",
    "User: copy this raw transcript into storage.",
    "Never retain ghp_1234567890abcdef1234 in a learning card.",
  ];

  for (const lesson of unsafeLessons) {
    assert.throws(() => prepareLearningCard({ ...card, lesson }, now), LearningValidationError);
  }
});

test("allows transferable slash syntax wrapped in inline code", () => {
  const prepared = prepareLearningCard(
    {
      ...card,
      lesson: "Keep `/api/v1`, `/skill:capture-learning`, and `/foo/u` exact when they are reusable identifiers.",
    },
    now,
  );

  assert.match(prepared.content, /`\/api\/v1`/u);
});

test("rejects structural headings, missing fields, and unknown fields", () => {
  assert.throws(
    () => prepareLearningCard({ ...card, lesson: "## Example\nThis breaks the card structure." }, now),
    /must not contain level-two Markdown headings/u,
  );
  const { limitations: _limitations, ...missingLimitations } = card;
  assert.throws(() => prepareLearningCard(missingLimitations, now), /limitations is required/u);
  assert.throws(() => prepareLearningCard({ ...card, destination: "elsewhere" }, now), /Unknown learning field/u);
});
