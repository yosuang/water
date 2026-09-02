---
name: handoff-herdr
description: "Hand off context to another tab in the current Herdr workspace, using the same agent kind as the caller, and leave the receiver idle."
disable-model-invocation: true
compatibility: "Requires a Herdr-managed agent pane (HERDR_ENV=1), the herdr CLI, and Node.js."
---

# Handoff Herdr

Transfer one bounded work item to a new agent of the caller's kind in another Herdr tab. The receiving agent gets context and waits; the caller retains ownership until the user explicitly continues in that tab.

## Invariants

- **Another tab**: create a new tab in the current workspace unless the user explicitly names an existing target tab.
- **Same agent kind**: read the caller's agent kind from Herdr and start that kind in the receiving tab.
- **Caller focus**: create and operate the handoff tab with `--no-focus`; leave the caller tab focused.
- **One-shot transfer**: send the complete handoff once through `scripts/send-handoff.mjs`.
- **File-backed payload**: put multiline handoff text in a UTF-8 temporary file. The helper passes it as an argument with `shell:false`, so code fences, backticks, `$()`, quotes, and Unicode remain literal.
- **No authority escalation**: the receiving agent acknowledges and becomes idle. Investigation, edits, tests, commits, pushes, and subagents require a later user instruction.
- **Opaque IDs**: read workspace, tab, and pane IDs from Herdr JSON responses.

## 1. Inspect Herdr

Confirm the caller is managed by Herdr and inspect the installed syntax:

```bash
test "${HERDR_ENV:-}" = 1
herdr --skill
herdr tab
herdr agent
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
herdr agent get "$HERDR_PANE_ID"
```

Stop when `HERDR_ENV` is unavailable or the caller pane has no recognized agent. Read the caller kind from `.result.agent.agent`; treat it as an opaque value accepted by `agent start --kind`. This step is complete when the current workspace, caller tab, caller agent kind, existing agent names, and `tab create` / `agent start` syntax are known.

## 2. Build the handoff

Write a concise handoff containing only information the receiving agent needs:

```markdown
# Handoff

## Objective
[The problem or finding being handed off]

## Current state
[Branch, relevant commit, completed work, and unresolved state]

## Evidence
[Exact paths/lines, reproduction, logs, tests, or review finding]

## Decisions and constraints
[Accepted design, invariants, excluded scope, and user preferences]

## Authorization
Context-only handoff. Wait for the user's next instruction before taking action.

## Validation background
[Passing checks and known unrelated failures]

## Suggested next step
[Possible direction, explicitly marked as not yet authorized]
```

Redact credentials, tokens, private payloads, and irrelevant local paths. Distinguish observed facts from suggestions.

Create a temporary file, then use the `write` tool to place the handoff there. Obtain the path without embedding handoff content in a shell command:

```bash
node -e "const fs=require('fs'),os=require('os'),path=require('path'); console.log(path.join(os.tmpdir(),'handoff-herdr-'+Date.now()+'.md'))"
```

This step is complete when the file contains the entire handoff and no shell has parsed its contents.

## 3. Create the tab and same-kind agent

Create a clearly labelled tab in the current workspace:

```bash
herdr tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --cwd "$PWD" \
  --label <short-handoff-label> \
  --no-focus
```

Read `.result.tab.tab_id` and `.result.root_pane.pane_id`. Start the caller's agent kind with a unique name matching `[a-z][a-z0-9_-]{0,31}`:

```bash
herdr agent start <agent-name> \
  --kind <caller-agent-kind> \
  --pane <root-pane-id>
```

Pass user-requested native startup arguments after `--`; otherwise use that agent kind's defaults. This step is complete when `agent start` reports an interactive agent of the caller's kind in `idle` state.

## 4. Transfer exactly once

Resolve `scripts/send-handoff.mjs` relative to this `SKILL.md`, then run it with the agent name and temporary file:

```bash
node <skill-dir>/scripts/send-handoff.mjs \
  <agent-name> \
  <handoff-file> \
  120000
```

The helper:

1. reads the UTF-8 file;
2. appends a unique acknowledgment marker and wait instruction;
3. invokes `herdr agent prompt` without a shell;
4. waits for settlement;
5. reads the transcript and requires both the sent marker and the agent's acknowledgment;
6. requires the receiving agent to finish in `idle` or `done` state.

A zero exit code and JSON result with `acknowledged: true` complete the transfer. Delete the temporary file after success.

## 5. Recover without blind resend

If the helper fails:

1. run `herdr agent get <agent-name>`;
2. read `herdr agent read <agent-name> --source recent-unwrapped --lines 160`;
3. determine whether the prompt arrived intact, the agent is working, or acknowledgment was missing;
4. correct the specific failure using the same file-backed helper.

When the full prompt already arrived, send only a bounded correction rather than duplicating the handoff. Keep all recovery payloads file-backed.

## 6. Report

Verify the caller tab remains focused:

```bash
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr agent get <agent-name>
herdr pane current --current
```

Report:

- tab label and ID;
- agent name and kind;
- acknowledgment result;
- final agent state;
- retry or correction count;
- whether the temporary file was removed.

Leave the new tab and agent available for the user's next instruction.
