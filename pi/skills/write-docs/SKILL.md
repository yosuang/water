---
name: write-docs
description: Write a project document using a Cloudflare Nimbus content recipe.
disable-model-invocation: true
compatibility: Requires npx and network access to load Nimbus recipes.
---

# Write Docs

Create or revise one project document. Nimbus supplies the editorial recipe; the target repository supplies the format, facts, and delivery conventions.

## 1. Select the document type

Read the command arguments and conversation for an explicit type. Accept either `content-<type>` or `<type>` and normalize it to `<type>`.

When no type is explicit, list the current recipes:

```bash
npx --yes @cloudflare/nimbus-docs list --type feature
```

Consider only `content-*` entries. Infer the type from the reader's intent, desired outcome, and expected page shape. Proceed when one type clearly fits. When multiple types would produce materially different documents, ask the user to choose between the best candidates and give a one-line distinction for each. When none fits, ask what the reader should accomplish or understand.

This step is complete when exactly one current `content-<type>` recipe has been selected.

## 2. Load the recipe

Print the selected recipe without installing its scaffold:

```bash
npx --yes @cloudflare/nimbus-docs add content-<type> --print
```

Read the complete output. Apply its guidance for purpose, audience, title, structure, content boundaries, thresholds, and checklist.

Keep delivery native to the target repository. In a Nimbus project, follow the confirmed local Nimbus setup. In any other project, translate the recipe into the repository's existing Markdown, MDX, frontmatter, component, and navigation conventions. Treat Nimbus paths and components as framework examples. Project setup, dependencies, and UI components remain unchanged unless the user explicitly requests those changes.

This step is complete when the recipe's requirements have been turned into a checklist for this document.

## 3. Establish the source material

Before asking the user, inspect the available evidence:

- repository instructions and documentation conventions;
- nearby documents and navigation structure;
- the code, configuration, schemas, tests, or history that own the documented behavior;
- user-provided notes, links, examples, audience, scope, and desired outcome.

Context is sufficient when the audience and scope are clear, every material claim and example has a trustworthy source, and every recipe-required section can be written without guessing product behavior. Investigate facts that the repository or supplied primary sources can answer. If gaps remain, ask one compact set of questions covering only the unresolved facts. Resume after the answers establish the missing source material.

This step is complete when every required fact is sourced or explicitly marked by the user as intentionally provisional.

## 4. Resolve the destination

Use an explicit destination from the user. Otherwise:

1. derive a concise topic slug from the document's subject;
2. choose the extension used by nearby documentation, falling back to `.md`;
3. save to `docs/<type>/<topic-slug>.<ext>`.

Create the type directory when needed. If the inferred path already exists, revise it only when the user asked to update that document; otherwise ask before replacing it.

This step is complete when one authorized target path is known.

## 5. Write the document

Write directly to the target path using the selected recipe and local conventions. Keep claims precise, examples realistic, headings self-contained, and links resolvable. Preserve the recipe's defining structure rather than blending in another document type. Use placeholders only when the user requested a provisional draft and make them unmistakable.

This step is complete when the saved document satisfies every applicable recipe requirement and repository rule.

## 6. Verify and report

Review the document against the recipe checklist line by line. Check referenced local paths, links, commands, examples, and frontmatter against their sources. Run repository-defined documentation lint or build checks when available, then inspect the diff for unintended changes.

Report the selected type, saved path, validation performed, and any deliberate checklist deviation or unresolved provisional content.
