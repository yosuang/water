# Experience Loop Extension

把 Pi 会话中的高摩擦工作提炼为本地经验卡片，并在后续相关任务开始前自动召回。Extension 负责信号、检索和持久化；`capture-learning` skill 负责由用户显式发起的内容提炼。

## 闭环

1. `session_start` 加载当前会话项目目录下的 `.water/learnings/*.md`。
2. `before_agent_start` 对空闲时提交的任务做本地 IDF 加权词法检索；queued steer/followUp 在 user `message_end` 检索，并在下一次 `context` 注入。相关结果最多 3 条、每组不超过 1200 字符。
3. `input` 记录用户纠正和 streaming steer，不保存输入文本。
4. `agent_settled` 从当前 session branch 统计工具调用、错误和打断；达到门槛后提示一次 `/skill:capture-learning`。交互式 TUI 下提示渲染为聊天流内的高亮卡片（`water-experience-hint` custom entry + entry renderer，随 session 持久化，展开可见摩擦明细），同时在输入框上方显示一行 widget；widget 一直钉住，直到经验成功保存才撤下（校验失败保留，方便重试）。session 恢复（resume/fork/reload）时依据当前 branch 的摩擦状态重新钉住或清掉残留 widget。其它带 UI 的模式（RPC）退回 `notify` 通知。
5. `save_learning` 只接受本包 skill 已成功展开的显式用户调用；每次展开授权一次写入，写入标准 Markdown 并立即刷新索引。

`session_shutdown` 不承担提示职责，因为此时旧 session runtime 正在拆除。

## 摩擦门槛

- 至少 15 次工具调用。
- 总分至少 20。
- interrupt / correction：每次 20 分。
- tool error：3 次 10 分、5 次 18 分、8 次 25 分，取最高档。
- 工具多样性：最多 5 分，不能单独触发提示。

Pi 没有通用的工具拒绝事件，因此不统计 TeamAI 的 `toolReject` 信号。提示卡片与保存状态通过 session custom entries 落在当前 branch，tree/fork 后按活动分支自然恢复；卡片不进入 LLM 上下文。

## 存储和召回

默认目录是当前会话工作目录（`ctx.cwd`）下的 `.water/learnings`，不同项目各自维护经验。一条经验一个 Markdown 文件：

```text
<project>/.water/
├── .gitignore
└── learnings/
    └── 2026-08-31-queue-complete-file-mutations.md
```

`session_start` 通过共享的 `@water/config` 模块初始化项目 `.water` 目录，并在缺失时创建内容为 `*` 的 `.gitignore`，使所有 Water 项目状态默认不进入 Git；已有 `.gitignore` 不会被覆盖。

索引覆盖标题、标签和正文，使用 `Intl.Segmenter` 支持中英文分词；标题、标签、正文的匹配权重分别为 3、2、1。低于相关性阈值时不修改 system prompt。

可在 Pi config home 的 `pi-water.json` 中覆盖目录；相对路径从配置文件所在目录解析：

```json
{
  "version": 1,
  "packages": {
    "pi-experience-loop": {
      "version": 1,
      "learningsDir": "learnings"
    }
  }
}
```

## 安全边界

- 普通 agent turn 调用 `save_learning` 会被拒绝；用户必须先运行 `/skill:capture-learning`。
- 工具不接受目标路径，文件名由日期和标题生成。
- 同日同标题的不同卡片使用内容哈希消除冲突；文件 mutation queue 防止并发覆盖。
- 常见密钥、私钥、带凭据 URL、本机绝对/用户目录路径和 transcript 形状会被拒绝；用 inline backticks 标记的 API routes、slash commands 与 regex literals 保持可用。skill 还会移除项目私有事实。
- 原始 transcript 不会复制到经验目录。

## 非目标

V1 不包含 Git 自动同步、团队投票、HTML doc-id 标记、向量数据库、dashboard 或代码知识图谱。删除 extension 即可停止闭环，已有经验文件保持不变。
