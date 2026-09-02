# Shared Instructions Extension

在 Pi 会话启动时读取本 package 的 `instructions/` 目录，将其中的 Markdown 共享指令追加到 agent 的 system prompt。目录通过 extension 文件位置解析，不受当前工作目录影响，也可以通过 Pi config home 下的 `pi-water.json` 覆盖。

## 功能

- 递归扫描 `instructions/**/*.md`。
- 移除文件顶部 frontmatter，只注入正文内容。
- 忽略空正文和非 Markdown 文件。
- 按相对路径排序，并在提示词中记录每个指令文件的本机绝对路径。
- 执行 `/reload` 后重新扫描。
- 目录缺失或路径不可读时发出 warning，但不阻断会话。

## 边界

- 默认只加载本 package 附带的共享指令，不读取当前项目中的指令目录。
- 只在 session 启动或 reload 时扫描，不监听文件变化。
- 不合并、校验或裁剪指令内容；冲突与优先级由最终 system prompt 决定。

## 使用

在 package 的 `instructions/` 中添加 Markdown 文件，然后启动 Pi 或执行 `/reload`：

```text
pi-instructions/
  instructions/
    mermaid.md
    subagent.md
```

全局覆盖使用 `pi-water.json`：

```json
{
  "version": 1,
  "packages": {
    "pi-instructions": {
      "version": 1,
      "instructionsDir": "instructions"
    }
  }
}
```

相对路径从 `pi-water.json` 所在目录解析。
