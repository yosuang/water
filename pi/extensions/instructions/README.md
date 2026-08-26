# Shared Instructions Extension

在 Pi 会话启动时读取 Water 包自身的 `pi/instructions/` 目录，将其中的 Markdown 共享指令追加到 agent 的 system prompt。目录通过 extension 文件位置解析，不受当前工作目录影响。

## 功能

- 递归扫描 `pi/instructions/**/*.md`。
- 移除文件顶部 frontmatter，只注入正文内容。
- 忽略空正文和非 Markdown 文件。
- 按相对路径排序，并在提示词中记录每个指令文件的本机绝对路径。
- 执行 `/reload` 后重新扫描。
- 目录缺失或路径不可读时发出 warning，但不阻断会话。

## 边界

- 只加载本 Water 包附带的共享指令，不读取当前项目中的 `pi/instructions/`。
- 只在 session 启动或 reload 时扫描，不监听文件变化。
- 不合并、校验或裁剪指令内容；冲突与优先级由最终 system prompt 决定。

## 使用

在 `pi/instructions/` 中添加 Markdown 文件，然后启动 Pi 或执行 `/reload`：

```text
pi/
  instructions/
    mermaid.md
    subagent.md
```
