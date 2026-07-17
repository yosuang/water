# Add Dir Extension

让 Pi 会话临时加入额外工作目录：这些目录会出现在会话上下文消息中，并参与 `@` 文件路径补全。

## 功能

- 提供 `/add-dir <path>` 命令添加目录。
- 支持 `/add-dir --list` 查看当前已添加目录。
- 支持 `/add-dir --remove <path>` 移除目录。
- 支持 `/add-dir --clear` 清空全部额外目录。
- 将目录状态写入 session，自然跟随当前会话分支恢复。
- 在 `@` 文件补全中合并额外目录下的匹配项。

## 边界

- 只接受已存在的目录，不会创建新目录。
- 额外目录只影响会话提示和 `@` 补全，不改变进程 cwd。
- 状态按当前 session branch 恢复，不作为全局配置保存。
- 文件补全依赖 Pi 的基础补全能力和可用的 `fd`/`fdfind`。

## 使用

```text
/add-dir ../other-project
/add-dir --list
/add-dir --remove ../other-project
/add-dir --clear
```

启用 extension 后，在 Pi 中运行 `/add-dir` 即可把额外目录加入当前会话。
