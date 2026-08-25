# Prompt Stash Extension

为 Pi 输入框提供一个轻量 prompt 暂存槽：可以把当前未发送的输入临时收起，之后再恢复到编辑器中。

## 功能

- 输入框有非空白文字时，使用转移快捷键暂存当前草稿并清空输入框。
- 输入框为空或只有空白字符时，使用同一个快捷键恢复已暂存草稿。
- 在编辑器上方显示已暂存 prompt 的短预览。
- 将暂存状态写入 session，并在会话恢复或 session tree 切换后重建。

## 快捷键

- macOS：`Cmd+S`，并保留 `Ctrl+S` 作为终端兼容键。
- 其他平台：`Ctrl+S`。

## 实现决策

该 extension 不使用 `pi.registerShortcut()` 注册 `Ctrl+S`。Pi v0.84.3 的启动检查会把不同界面作用域的内置快捷键压入同一张表，因此会把 Prompt Editor、Session Picker 和 `/scoped-models` 各自使用的 `Ctrl+S` 误报为冲突；当前也没有 extension 侧的 warning suppression 或 shortcut scope 选项。详见 [调查记录](./docs/pi-shortcut-conflict-research.md) 和官方 [issue #7070](https://github.com/earendil-works/pi/issues/7070)。

为避免要求用户修改全局 `keybindings.json`，该 extension 在 Editor seam 上包装当前 `EditorComponent`，只在主输入编辑器获得焦点时拦截转移快捷键，其余输入、回调和编辑器能力都委托给被包装的编辑器。没有使用 `onTerminalInput()`，因为它在焦点分发前全局执行，会截获 Picker 中本应保留的 `Ctrl+S`。

这个方案避免了误报警告，也能与更早加载的自定义编辑器组合；如果更晚加载的 extension 直接替换编辑器而不包装现有编辑器，Prompt Stash 的按键处理仍可能被覆盖。

## 边界

- 只保留一个暂存槽，新暂存会覆盖旧内容。
- 恢复会消费暂存内容；暂存槽为空时快捷键不执行操作。
- 草稿的首尾空白会原样保留，但只有空白字符的输入框视为空白。
- 暂存内容属于当前会话分支，不作为全局配置保存。
- 该 extension 包装当前编辑器，不注册全局 extension shortcut 或 slash command。

## 使用

启用 extension 后，直接在 Pi 输入框中使用快捷键即可。暂存成功后会看到 `Stashed (...)` 预览。
