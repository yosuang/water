# Experience Loop Extension

把 agent session 中的高摩擦工作提炼为项目本地经验卡片，并在后续相关任务开始前自动召回。Pi extension 负责把 Pi 生命周期转换成 agent-neutral session state；`capture-learning` skill 负责提炼内容，其独立 TypeScript script 负责校验和保存。

## 闭环

1. `session_start` 为当前 Pi session 初始化 `.water/sessions/pi-<session-id>.json`，并加载 `.water/learnings/*.md`。
2. `before_agent_start` 对空闲时提交的任务做本地 IDF 加权词法检索；queued steer/followUp 在 user `message_end` 检索，并在下一次 `context` 注入。每次检索都会刷新文件索引，相关结果最多 3 条、每组不超过 1200 字符。
3. `input` 把用户纠正和 streaming steer 记录到物理 Session State，不保存输入文本。
4. `agent_settled` 从当前 session branch 统计工具调用、错误和打断，把快照写入 Session State；达到门槛后提示一次 `/skill:capture-learning`。TUI 使用输入框上方的 widget，RPC 使用 `notify`。
5. `capture-learning` 使用普通 shell 执行 `scripts/save-learning.ts`。脚本写入经验卡片，并在同一个 Session State 中记录成功结果；下一次 `agent_settled` 或 session 恢复时，extension 据此撤下 widget。

Extension 不使用 Pi custom entries 保存状态，也不注册 `save_learning` custom tool。`session_shutdown` 不承担提示职责，因为此时旧 session runtime 正在拆除。

## Session State

每个顶层 agent session 在当前项目中拥有一个状态文件：

```text
<project>/.water/
├── .gitignore
├── learnings/
│   └── 2026-08-31-queue-complete-file-mutations.md
└── sessions/
    └── pi-550e8400-e29b-41d4-a716-446655440000.json
```

文件名由 agent 和宿主提供的稳定 session ID 组成。状态只包含身份、摩擦计数、工具名称、提示时间和成功保存的 learning ID；不包含 prompt、transcript、工具输入输出、模型或 provider。

`WATER_AGENT` 与 `WATER_SESSION_ID` 是跨 adapter 的标准身份变量；可选的 `WATER_AGENT_DIR` 指向包含 `pi-water.json` 的 Water 配置目录。Pi 的 shell command 无需额外配置：脚本会使用 `AI_AGENT=pi`、`PI_SESSION_ID` 和 Pi 默认配置目录。身份缺失或包含不安全的文件名字符时，脚本会失败，不会随机生成 ID。

Session State 的更新通过短期锁串行化，并使用同目录临时文件替换正式 JSON，避免 extension 与 script 并发修改时丢失状态。损坏或版本不兼容的状态文件不会被默认值覆盖。

## 摩擦门槛

- 至少 15 次工具调用。
- 总分至少 20。
- interrupt / correction：每次 20 分。
- tool error：3 次 10 分、5 次 18 分、8 次 25 分，取最高档。
- 工具多样性：最多 5 分，不能单独触发提示。

Pi 没有通用的工具拒绝事件，因此不统计 TeamAI 的 `toolReject` 信号。`/new` 和 fork 使用新的 session ID 与状态文件；resume 和 reload 复用原 session ID。经验卡片是项目级数据，不随 session 切换。

## 存储和召回

默认经验目录是当前工作目录下的 `.water/learnings`。项目 `.water/.gitignore` 在缺失时创建为 `*`，使 Water 状态默认不进入 Git；已有文件不会被覆盖。

索引覆盖标题、标签和正文，使用 `Intl.Segmenter` 支持中英文分词；标题、标签、正文的匹配权重分别为 3、2、1。低于相关性阈值时不修改 system prompt。

可在 Pi config home 的 `pi-water.json` 中覆盖经验目录；相对路径从配置文件所在目录解析：

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

## 独立保存脚本

`skills/capture-learning/scripts/save-learning.ts` 是普通 TypeScript CLI，不导入 Pi extension 或使用 `ExtensionAPI`。它只依赖 Node.js 内置模块和本包的 agent-neutral 模块。Agent 保持项目 cwd，并执行：

```text
bun <script> <card-json-file>
```

脚本从临时 JSON 读取卡片，不接受目标路径。成功时 stdout 只输出一个 JSON 结果；错误写入 stderr 并使用非零退出码。

## 安全边界

- `capture-learning` 只能由用户显式调用；skill script 不构成额外授权系统。
- 输入必须是只含标准字段的 JSON 对象，未知字段会被拒绝。
- 文件名由日期和标题生成；同日同标题的不同卡片使用内容哈希避免覆盖。
- 常见密钥、私钥、带凭据 URL、本机绝对/用户目录路径和 transcript 形状会被拒绝；inline backticks 中的 API routes、slash commands 与 regex literals 保持可用。
- 原始 transcript 不会复制到经验目录或 Session State。

## 代码结构

`src/experience-loop.ts` 是唯一的 Pi extension 入口和事件装配点：

- `agent-session.ts`：标准 Session Identity 和物理文件路径；
- `session-state.ts`：状态 schema、更新事件、锁和原子写入；
- `pi-session-friction.ts`：把 Pi branch 转换成工具活动快照；
- `session-friction.ts`：agent-neutral 摩擦评分与提示策略；
- `experience-recall.ts`：即时与 queued prompt 的召回和上下文注入；
- `experience-hint.ts`：widget 与通知文案；
- `learning-card.ts`：卡片运行时校验、安全规则与 Markdown 格式；
- `learning-store.ts`：持久化、索引和检索；
- `learning-config.ts`：经验目录配置；
- `water-project.ts`：项目 `.water` 目录初始化。

测试位于 `test/`，其中 `save-learning-script.test.ts` 通过真实 Bun 子进程执行保存脚本。

## 非目标

V1 不包含 Git 自动同步、团队投票、向量数据库、dashboard、代码知识图谱或所有 agent adapter。当前包实现 Pi adapter，并为后续 Claude Code、Codex 和 OpenCode adapter 提供相同的 Session Identity 与文件协议。
