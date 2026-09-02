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
- **Location:** `packages/pi-instructions/instructions/mermaid.md`
- **Affected:** Pi 0.84.3, which bundles grok-mermaid 0.2.2.
- **Reason:** Quoted inline edge labels containing link characters such as `>`, `.`, or `=` produce parse warnings.
- **Remove when:** Pi's active terminal renderer renders the probe below as a Unicode diagram without a `Mermaid diagram not rendered` warning.
- **Probe:** Start Pi and render `flowchart TD; A -- "line<br/>file.png = output" --> B` in a Mermaid code block.
- **Removal:** Delete the quoted-pipe-syntax rule from `packages/pi-instructions/instructions/mermaid.md`, delete this entry, run `bun run test:pi`, then repeat the probe.

### COMPAT-002 — Bun catalog source installs

- **Constraint:** Install the source monorepo with `bun install` before adding its root as a local Pi package; publish or pack distributable packages with Bun so `catalog:` references become ordinary semver ranges.
- **Location:** Root and workspace `package.json` files.
- **Affected:** Pi 0.84.4, whose git package installer runs `npm install`; npm does not resolve Bun's `catalog:` protocol.
- **Reason:** Bun workspace catalogs are the repository's single dependency-version source.
- **Remove when:** Pi's package installer can install Bun catalog workspaces directly.
- **Probe:** From a clean clone, run `pi install git:<repository>` and confirm dependency installation and package loading succeed without pre-running Bun.
- **Removal:** Delete this entry and document direct git installation in `README.md`.
