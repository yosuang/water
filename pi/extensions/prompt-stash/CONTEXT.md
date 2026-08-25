# Prompt Stash

Prompt Stash covers temporarily moving one unsent draft out of Pi's prompt editor and returning it later.

## Language

**Input Draft**:
The exact unsent text currently held in Pi's prompt editor, including its leading and trailing whitespace.
_Avoid_: Prompt, input

**Stash Slot**:
The single branch-local place that can hold one Input Draft outside the prompt editor.
_Avoid_: Clipboard, history, queue

**Transfer Shortcut**:
The context-sensitive action that moves a non-blank Input Draft into the Stash Slot, or moves the stashed draft back when the editor is blank.
_Avoid_: Stash shortcut, restore shortcut, toggle
