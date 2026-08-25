# Pi shortcut-conflict research

**Research date:** 2026-08-25  
**Scope:** Official `earendil-works/pi` issues, pull requests, and the `v0.84.3` source tag, inspected with `gh` CLI.

## Findings

- **Issue #7070 is exactly the prompt-stash `Ctrl+S` / `app.models.save` warning.** The report links `prompt-stash.ts`, shows `pi.registerShortcut("ctrl+s", ...)`, quotes the warning naming `app.models.save`, and says both the editor stash action and `/scoped-models` save action work in their respective contexts. It explicitly distinguishes itself from #4131. [Issue #7070](https://github.com/earendil-works/pi/issues/7070)

- **Triage outcome: rejected / not planned.** #7070 is closed as `NOT_PLANNED` and carries `no-action` (“rejected after triage”). Its only reply is the automatic new-contributor closure notice; no human maintainer replied. Consequently, **maintainers gave no workaround**. [Issue #7070](https://github.com/earendil-works/pi/issues/7070) · [automatic closure comment](https://github.com/earendil-works/pi/issues/7070#issuecomment-5069127387)

- **#4131 is related but different.** It reported a warning based on the old default even after `app.models.save` had been remapped in `keybindings.json`; it too ended `NOT_PLANNED`/`no-action`, without a maintainer workaround. [Issue #4131](https://github.com/earendil-works/pi/issues/4131)

- **Scope-aware detection was proposed, but not merged.** PR #2403 proposed typed `global`, `editor`, `selection`, `sessionPicker`, and `treePicker` scopes and checking extension conflicts only in global/editor contexts. A maintainer closed it because an overlapping keybinding refactor was underway; it has no merge commit. [PR #2403](https://github.com/earendil-works/pi/pull/2403) · [maintainer closure](https://github.com/earendil-works/pi/pull/2403#issuecomment-4093776706)

- **The later merged work was not scope-aware warning suppression.** #3326 correctly observed that overlapping defaults across editor/picker contexts are operationally valid. Merged PR #3343 made scoped-model and tree-filter actions configurable and made reserved actions win collisions in the flat conflict map; it did not merge #2403's scope metadata/filter. [Issue #3326](https://github.com/earendil-works/pi/issues/3326) · [PR #3343](https://github.com/earendil-works/pi/pull/3343) · [merge commit](https://github.com/earendil-works/pi/commit/d4e2e563ae09b877675a73f4dcbdf6655d46efe0)

## What v0.84.3 actually does

`ExtensionRunner` builds one flat map from **all resolved keybindings**. Its reserved list controls whether an extension binding is rejected; it does not exclude picker-only actions from detection. A collision with a non-reserved action emits a warning and keeps the extension shortcut. `app.models.save` is not reserved, so #7070's warning is noisy but the stash shortcut remains active. [runner.ts, reserved list and flat-map construction](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/extensions/runner.ts#L68-L113) · [runner.ts, conflict behavior](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/extensions/runner.ts#L494-L536)

Interactive mode passes the effective user-resolved configuration into that detector, installs accepted extension shortcuts only on the default editor, and surfaces diagnostics at startup. Thus picker-local `Ctrl+S` and editor-local extension `Ctrl+S` can both work even though the flat detector warns. This also means the stale-default condition from #4131 is not present in v0.84.3. [interactive-mode.ts, startup diagnostics](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1965-L1977) · [interactive-mode.ts, effective config and editor handler](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2066-L2122)

Issue #3617 led to startup display of shortcut diagnostics (matching reload), not context-aware detection. The maintainer also rejected synchronous `registerShortcut()` success reporting because conflicts are evaluated only after all extensions register. [Issue #3617](https://github.com/earendil-works/pi/issues/3617) · [maintainer resolution](https://github.com/earendil-works/pi/issues/3617#issuecomment-4308284833)

## Warning-free options in v0.84.3

1. **Register a key absent from the effective built-in map.** This is the simplest extension-only option.
2. **Keep extension `Ctrl+S`, but remap or disable every built-in `Ctrl+S` binding in `~/.pi/agent/keybindings.json`.** v0.84.3 defaults both `app.session.toggleSort` and `app.models.save` to `ctrl+s`; changing only `app.models.save` can merely expose the session-sort collision. [keybindings.ts, both defaults](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/keybindings.ts#L161-L184)
3. **Avoid `registerShortcut()` and intercept the key at the Editor seam.** Wrapping the current `EditorComponent` with `getEditorComponent()` / `setEditorComponent()` avoids shortcut diagnostics and leaves Picker input routing untouched, at the cost of editor-extension composition becoming load-order-sensitive.

For example, assign both built-in actions unused alternatives, or disable both with empty arrays:

```json
{
  "app.session.toggleSort": [],
  "app.models.save": []
}
```

The loader accepts string or string-array overrides (including empty arrays), and `getEffectiveConfig()` returns the resolved bindings consumed by the detector. [keybindings.ts, config loading and effective config](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/src/core/keybindings.ts#L310-L392)

There is **no v0.84.3 scope declaration or warning-suppression setting** for an extension shortcut. Leaving the defaults unchanged and accepting the warning remains operational, but is not warning-free.
