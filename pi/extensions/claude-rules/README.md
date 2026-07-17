# Claude Rules Extension

在 Pi 启动会话时读取当前项目的 `.claude/rules/` 目录，将无需路径条件的 Markdown 规则追加到 agent 的 system prompt，让 Claude Code 项目规则可以在 Pi 中复用。

## 功能

- 递归扫描 `.claude/rules/**/*.md`。
- 去除文件顶部 frontmatter，只注入正文内容。
- 按相对路径排序后注入，保留来源路径。
- 会话启动时提示已加载的无条件规则数量。
- 遇到包含 `paths:` frontmatter 的规则时跳过，并提示跳过数量。

## 边界

- 只处理 Markdown 规则文件，不读取其他格式。
- 只加载无路径作用域的规则，不支持 `paths` 条件规则的按文件懒加载。
- 只在会话启动时扫描，不监听规则文件变化。
- 不合并、校验或裁剪规则内容，冲突与优先级由最终提示词上下文决定。
- 不改变 Claude Code 的规则语义，只提供面向 Pi 的兼容加载层。

## 使用

```text
.claude/
  rules/
    general.md
    frontend/react.md
```

启用 extension 后，在项目根目录启动 Pi 即可。需要按路径生效的规则可以保留在 `.claude/rules/` 中，但它们不会被注入。
