---
name: capture-learning
description: Capture one reusable lesson from the current Pi session in the local learning store.
disable-model-invocation: true
---

# Capture Learning

Capture one durable lesson from the active session branch. The user's invocation authorizes one learning write through `save_learning`.

## 1. Pass the evidence gate

Identify one conclusion supported by work completed in this branch: a corrected approach, non-obvious invariant, failure mode, or verification technique. Prefer the lesson that would materially change a future agent's behavior.

When the branch contains only routine work, a project fact, or an unverified guess, explain that there is no reusable lesson and stop. This step is complete when one evidence-backed lesson remains or capture has stopped.

## 2. Pass the redaction gate

Rewrite the lesson as transferable guidance. Remove credentials, raw prompts, transcript text, usernames, machine paths, repository-private names, issue or PR numbers, commit hashes, customer details, and private product constraints. Replace a necessary example with neutral placeholders.

When the lesson cannot remain useful after redaction, explain why and stop. This step is complete when the card stands alone without private session context.

## 3. Build one card

Prepare every `save_learning` field:

- `title`: a specific conclusion, at most 100 characters;
- `tags`: 2–5 stable discovery terms, preferring ecosystem-standard technical names;
- `applicability`: the conditions that make the lesson relevant;
- `lesson`: the action or invariant a future agent should apply;
- `rationale`: why it works or what failure it prevents;
- `verification`: an observable check that can confirm it;
- `limitations`: where the lesson does not apply.

Use the user's language for prose and preserve code identifiers exactly. Wrap reusable routes, slash commands, and regex literals in inline backticks so the store can distinguish them from machine paths. This step is complete when every claim is supported by this branch and every field is actionable.

## 4. Save through the extension

Call `save_learning` with the finished card. The extension owns validation, naming, serialization, concurrency, and storage; do not write a learning file directly. If validation rejects one field, correct that field and retry within this capture turn.

Report the returned learning id and path. Capture is complete when the tool confirms the durable file or reports that the same learning already exists.
