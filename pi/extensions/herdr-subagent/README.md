# Herdr Subagent command

`/herdr-subagent` is the manual UI entry point for the existing `herdr-subagent` skill.

```text
/herdr-subagent [#provider/model[:effort]] [task...]
```

Examples:

```text
/herdr-subagent review the authentication changes
/herdr-subagent #openai/gpt-5 review the authentication changes
/herdr-subagent #openai/gpt-5:high review the authentication changes
```

In TUI mode, selecting `/herdr-subagent` with Tab immediately opens the child-model completions. `Use Pi default` skips model selection; selecting a reasoning model immediately opens effort completions, where `Use model default` skips effort selection. Typing the task at either menu also keeps the corresponding default. No task separator is required.

The selected model affects Herdr child agents only. The extension does not change the coordinator model. It dispatches `/skill:herdr-subagent` with prompt-template expansion, leaving `pi/skills/herdr-subagent/SKILL.md` as the workflow source of truth.

The command requires Pi 0.84.2 or newer and the native `/skill:herdr-subagent` command to be enabled.
