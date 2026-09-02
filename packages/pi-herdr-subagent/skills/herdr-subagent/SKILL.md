---
name: herdr-subagent
description: "Use Herdr to coordinate multiple Pi subagents in the current tab for parallel research, review, or implementation tasks. Use when the user explicitly asks for Herdr subagents, parallel Pi delegation, or an agent group. Keep the main Pi in a full-height pane on the left half of the tab, arrange all subagents neatly in the right half, and manage startup, dispatch, monitoring, recovery, and synthesis."
compatibility: "Requires a Herdr-managed pane (HERDR_ENV=1), the herdr CLI, and pi."
---

# Herdr Subagents

Use Herdr as Pi's subagent runtime. The current Pi coordinates the work. Other Pi instances execute bounded tasks. The coordinator owns the final judgment and deliverable.

## Invariants

- **Left-half main**: The caller pane (`HERDR_PANE_ID`) occupies the full-height left half of the tab. Create, split, and reuse subagent panes only in the right half. Never split the main pane downward.
- **One tab**: Use the current tab by default. Create a new tab, workspace, or worktree only when the user explicitly requests one.
- **Main pane stays focused**: Use `--no-focus` for pane creation and background operations.
- **Orderly layout**: Keep right-side panes evenly sized when practical. Aim for at least 40 columns by 10 rows per visible Pi. If the tab is too small, run tasks in waves and reuse panes instead of squeezing in every task.
- **Clear ownership**: Rearrange or close only panes created during the current run. Ask the user before changing an existing pane whose purpose is unknown.
- **Opaque IDs**: Read workspace, tab, and pane IDs from Herdr's JSON responses. Use explicit IDs, `--current`, or unique agent names in later commands.

## 1. Check the environment and CLI

Confirm that the current Pi runs inside Herdr:

```bash
test "${HERDR_ENV:-}" = 1
```

If the check fails, explain that Herdr control is unavailable and stop. If it succeeds, read the installed CLI's current instructions and inspect the layout:

```bash
herdr --skill
herdr pane
herdr agent
herdr pane layout --pane "$HERDR_PANE_ID"
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Do not run bare `herdr` for discovery because it launches or attaches the TUI.

This step is complete when you know the caller pane, current tab topology, existing agents, and the installed syntax for `pane split`, `agent start`, and `agent prompt`.

## 2. Divide the work

Create only subagents that can make independent progress. Define these fields before starting each one:

- A unique short name matching `[a-z][a-z0-9_-]{0,31}`
- A bounded objective
- A working directory
- A verifiable deliverable
- Whether file edits are allowed
- A write scope that does not overlap with another subagent

Research, code tracing, and independent review parallelize well. If several agents would edit the same file, assign one implementation agent and make the others read-only reviewers, or give each agent a disjoint file set. The main Pi divides and synthesizes the work. Do not send the complete task unchanged to every agent.

## 3. Build the left-half main layout

Inspect `pane layout` before splitting anything.

If the current tab contains only the main pane, make the first split to the right and set a 50/50 ratio:

```bash
herdr pane split --current --direction right --ratio 0.5 --cwd <task-1-cwd> --no-focus
```

Read `.result.pane.pane_id` from the response and treat it as the right-side root pane. Make every later split inside the right half.

Choose a right-side layout based on the available dimensions:

| Concurrent agents | Preferred layout |
|---|---|
| 1 | One pane filling the right half |
| 2 | Two equal-height rows |
| 3 | Three equal-height rows |
| 4 | A 2 by 2 grid when panes remain usable; otherwise four rows or two waves |
| 5 or more | A near-square grid when it fits; otherwise use waves and reuse panes |

For equal-height rows, split only the unassigned tail region and set the ratio from the number of rows still needed. For three rows, first carve out about `1/3`, then split the remaining region at `1/2`. Read `pane layout` after every split and adjust with `pane resize` if needed. Two blind 50/50 splits produce `1/2 + 1/4 + 1/4`, not three equal rows.

Reuse idle agents or empty shell panes when the tab already has a valid left-half main layout. If the main pane is not full-height on the left half, use `pane swap` or `pane resize` only when every other affected pane belongs to the current run. Otherwise, ask the user before reshaping the tab.

This step is complete when the main pane occupies the full-height left half and every planned visible subagent pane sits in the usable right half.

## 4. Start Pi subagents

Set each task's working directory with `--cwd` when creating its pane. Once the new pane shows an idle foreground shell, start Pi:

```bash
herdr agent start <name> --kind pi --pane <pane-id> -- --model <model>
```

Use the model requested by the user. If no model was requested, use Pi's default. A thinking level may be included in the model pattern:

```bash
herdr agent start researcher --kind pi --pane <pane-id> -- --model gtlm/deepseek-v4-flash:max
```

`agent start` must return a detected, interactive Pi. When reusing a pane with the wrong working directory, run `cd` in its idle shell and confirm that the prompt returns before calling `agent start`. If necessary, launch Pi directly with `pane run "cd <cwd> && pi --model <model>"`, wait until `agent list` detects it, and then assign a unique name with `agent rename`.

This step is complete when every planned pane hosts the expected Pi under a unique name and can accept a prompt in the `idle` state.

## 5. Dispatch all tasks

Give each subagent a separate task contract:

```text
Objective: What it must answer or complete
Scope: Directories and files it may read or change
Checks: Questions it must investigate
Evidence: Required path:line citations, test results, or command output
Deliverable: Expected format, length, or output file
Constraints: Read-only or editable scope, excluded areas, and stop conditions
```

Prompt every agent before waiting for any one of them, so the work starts in parallel:

```bash
herdr agent prompt <agent-1> "<task-1>"
herdr agent prompt <agent-2> "<task-2>"
herdr agent prompt <agent-3> "<task-3>"
```

Then poll with `herdr agent list`, or run `agent wait --timeout <ms>` concurrently for all active tasks. Do not wait for one agent to finish before starting the next.

This step is complete when each task has reached the intended agent and produced an observed lifecycle change.

## 6. Monitor and recover

Use the agent interface for normal coordination:

```bash
herdr agent get <name>
herdr agent read <name> --source recent-unwrapped --lines 120
herdr agent wait <name> --timeout 600000
```

Handle states as follows:

- `working`: Keep waiting. Do not send the task again.
- `done` or `idle`: Read the result. Inspect the output when an agent finishes unexpectedly fast instead of assuming success.
- `blocked`: Read the question. Answer it when safe, or pass it to the user.
- `unknown`: Treat it as unclassified, not complete. Read the output and process information before deciding what happened.

Use these recovery rules:

- For a 429 response, deployment cooldown, or temporary model shortage, wait for the reported cooldown and resend the same task to the same agent. Do not switch models when the user fixed the model choice.
- For `agent_prompt_stalled`, read recent output and confirm that no earlier task is still running before resending.
- After a wait timeout, run `agent get` and `agent read` to distinguish active work, a blocked agent, and failure.
- If the alternate screen hides a long result, ask the agent to write the complete response to a Markdown file and reply only with its path. Use this only after normal reading fails, not in the initial prompt.

After each retry, confirm that the lifecycle state changes. A subtask ends only when it completes, blocks on a clear dependency, or reaches an unrecoverable failure.

## 7. Synthesize and deliver

The main Pi reads every result and then:

1. Checks each deliverable against its task contract.
2. Samples important `path:line` references, commands, and tests instead of trusting the report without verification.
3. Resolves conflicting findings. Ask the original agent for evidence or assign a read-only verification agent when needed.
4. Produces the requested final answer or code change and lists any unresolved items.

Keep the right-side Pi instances and panes available for follow-up by default, with focus on the main pane. Close only panes created during the current run, and only when the user asks for cleanup. The final response should briefly report agent names, task status, artifact paths, and any retries or failures.

## Safety boundaries

- Leave pre-existing panes with unknown purposes in place.
- Never stop the Herdr server or kill the main Herdr process.
- Target panes and agents explicitly instead of relying on UI focus.
- Use `agent prompt` and `agent read` for normal agent interaction. Use `pane send-*` only for intentional raw terminal control.
