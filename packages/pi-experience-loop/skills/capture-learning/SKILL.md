---
name: capture-learning
description: Capture one reusable lesson from the current agent session in the local learning store.
disable-model-invocation: true
compatibility: Requires Bun plus write and shell tools. The agent adapter must expose WATER_AGENT and WATER_SESSION_ID; Pi sessions work without setup.
---

# Capture Learning

Capture one durable lesson from the active agent session. The bundled TypeScript script owns validation, naming, persistence, and session-state completion.

## 1. Pass the evidence gate

Identify one conclusion supported by work completed in this session: a corrected approach, non-obvious invariant, failure mode, or verification technique. Prefer the lesson that would materially change a future agent's behavior.

When the session contains only routine work, a project fact, or an unverified guess, explain that there is no reusable lesson and stop. This step is complete when one evidence-backed lesson remains or capture has stopped.

## 2. Pass the redaction gate

Rewrite the lesson as transferable guidance. Remove credentials, raw prompts, transcript text, usernames, machine paths, repository-private names, issue or PR numbers, commit hashes, customer details, and private product constraints. Replace a necessary example with neutral placeholders.

When the lesson cannot remain useful after redaction, explain why and stop. This step is complete when the card stands alone without private session context.

## 3. Write one temporary card

Prepare one JSON object with exactly these fields:

- `title`: a specific conclusion, at most 100 characters;
- `tags`: 2–5 stable discovery terms, preferring ecosystem-standard technical names;
- `applicability`: the conditions that make the lesson relevant;
- `lesson`: the action or invariant a future agent should apply;
- `rationale`: why it works or what failure it prevents;
- `verification`: an observable check that can confirm it;
- `limitations`: where the lesson does not apply.

Use the user's language for prose and preserve code identifiers exactly. Wrap reusable routes, slash commands, and regex literals in inline backticks so the store can distinguish them from machine paths. Every claim must be supported by this session and every field must be actionable.

Resolve a UTF-8 temporary file path without embedding card content in a shell command, then use the write tool to place the JSON there:

```bash
bun -e "const os=require('os'),path=require('path'); console.log(path.join(os.tmpdir(),'water-learning-'+Date.now()+'.json'))"
```

This step is complete when the temporary file contains only the finished JSON object.

## 4. Save through the standalone script

Resolve `scripts/save-learning.ts` relative to this `SKILL.md`. Keep the shell working directory at the user's project; do not change into the skill directory. Run:

```bash
bun <skill-dir>/scripts/save-learning.ts <card-json-file>
```

The script runs as an ordinary TypeScript CLI. It resolves the current agent session, writes the learning card, and updates `.water/sessions/<agent>-<session-id>.json`. Do not write either file directly.

A zero exit code with one JSON result on stdout completes the save. If validation rejects a field, correct the temporary JSON and rerun the same script. For other errors, report the error without bypassing the script. Delete the temporary file when the attempt is complete.

## 5. Report

Report the returned learning id and path. Capture is complete when the script confirms the durable file or reports that the same learning already exists.
