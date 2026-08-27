# Compatibility Constraints

This file tracks active rules that exist only to accommodate external tooling. Assign each constraint a stable `COMPAT-NNN` identifier and add or remove its rule and ledger entry in the same commit.

Use this trailer when introducing a constraint:

```text
Compatibility-Constraint: COMPAT-NNN
```

Use this trailer when resolving one:

```text
Resolves-Compatibility-Constraint: COMPAT-NNN
```

Remove resolved entries; Git history retains them. Use `git log --grep COMPAT-NNN` to find their introducing or resolving commits.

## Active

### COMPAT-001 — Mermaid labeled flowchart edges

- **Constraint:** Labeled flowchart edges use quoted pipe syntax.
- **Location:** `pi/instructions/mermaid.md`
- **Affected:** Pi 0.84.3, which bundles grok-mermaid 0.2.2.
- **Reason:** Quoted inline edge labels containing link characters such as `>`, `.`, or `=` produce parse warnings.
- **Remove when:** Pi's active terminal renderer renders the probe below as a Unicode diagram without a `Mermaid diagram not rendered` warning.
- **Probe:** Start Pi and render `flowchart TD; A -- "line<br/>file.png = output" --> B` in a Mermaid code block.
- **Removal:** Delete the quoted-pipe-syntax rule from `pi/instructions/mermaid.md`, delete this entry, run `npm run test:pi`, then repeat the probe.
