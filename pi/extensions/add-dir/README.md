# Add Dir Extension

让 Pi 会话临时加入额外工作目录：这些目录会出现在会话上下文消息中，并参与 `@` 文件路径补全。

## 功能

- 提供 `/add-dir <path>` 命令添加目录；在 TUI 中省略路径会打开目录输入框。
- 输入 `/add-dir --` 时补全管理操作。
- 支持 `/add-dir --list` 查看当前已添加目录。
- 支持 `/add-dir --remove <path>` 移除目录，并补全当前已添加的目录。
- 支持 `/add-dir --clear` 清空全部额外目录。
- 将目录状态写入 session，自然跟随当前会话分支恢复。
- 在 `@` 文件补全中合并额外目录下的匹配项。

## 边界

- 只接受已存在的目录，不会创建新目录。
- 额外目录只影响会话提示和 `@` 补全，不改变进程 cwd。
- 状态按当前 session branch 恢复，不作为全局配置保存。
- 文件补全依赖 Pi 的基础补全能力和可用的 `fd`/`fdfind`。

## 使用

添加目录是默认流程：输入 `/add` 后按 Tab 选择 `/add-dir`，再按 Enter 打开目录输入框；也可以直接传入路径。

```text
/add-dir
/add-dir ../other-project
```

管理操作只在输入 `--` 后出现补全：

```text
/add-dir --list
/add-dir --remove ../other-project
/add-dir --clear
```

输入 `/add-dir --remove ` 后再按 Tab，会补全当前已添加的目录。
