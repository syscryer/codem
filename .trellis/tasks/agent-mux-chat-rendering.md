# Task: Agent Mux 输出渲染与取消按钮

## Background

Agent Mux 运行监控已经保存真实运行事件，但当前仍按纯文本逐行展示，Markdown、代码块和链接都不可读；运行中的取消操作也沿用了普通文字危险按钮，与聊天区成熟的停止控件不一致。需要复用聊天的纯展示能力，同时保持两条运行链路互不影响。

## Objective

修正运行中取消按钮样式，并让 Agent Mux 独立复用聊天 Markdown 展示能力

## Scope

In scope:

- 将聊天 Markdown 的纯展示部分提取为共享组件，并保持聊天现有调用行为不变。
- 抽取聊天与 Agent Mux 共用的标准 Agent 事件流消费函数。
- Agent Mux 持久化标准 `AgentRunEvent` payload，并通过聊天现有 reducer 和 `ConversationTurnView` 原样回放。
- 运行中的标准事件立即更新内存 turn；连续 delta 仅在 SQLite 持久化层合并，不能牺牲实时显示。
- 将运行中的取消操作改为聊天停止控件同语义的紧凑方形图标按钮。
- 覆盖事件分组、共享渲染接入和按钮可访问性回归测试。

Out of scope:

- 不接入聊天会话状态、滚动状态、历史缓存或运行 hooks。
- 不把 Agent Mux 运行记录混入聊天会话表、聊天历史或聊天运行状态。
- 不增加任何按 Agent 类型分支的日志解析器。
- 不在运行完成后保留取消按钮占位。
- 不扩展等待用户输入或权限确认的交互闭环。

## Impact

- Frontend shared rendering: `src/components/MarkdownContent.tsx`
- Conversation regression boundary: `src/components/ConversationTurn.tsx`
- Agent Mux monitor: `src/components/AgentMuxPrototype.tsx`
- Shared event stream/reducer: `src/lib/agent-run-events.ts`
- Agent Mux transcript adapter: `src/lib/agent-mux-events.ts`
- Persistent event payload: `src-tauri/src/agent_mux.rs`
- Styles/tests: `src/styles.css`, `src/lib/*.test.ts`

## Acceptance Criteria

- [x] 运行中的取消按钮为 32px 紧凑圆形图标按钮，使用方形停止图标，并有 `title`、`aria-label` 和可见焦点态。
- [x] 非运行态不渲染取消按钮，也不保留空占位。
- [x] Agent Mux 与聊天使用同一个 NDJSON 事件流消费函数、`applyAgentRunEventToTurn` reducer 和 `ConversationTurnView`。
- [x] 文本、Thinking、工具、Markdown、代码块、链接、完成与错误状态沿用聊天现有展示。
- [x] 连续 delta 事件在持久化前合并，标准事件 payload 可从 SQLite 恢复；旧纯文本事件仍兼容回放。
- [x] 运行中的每个标准事件立即更新内存 turn，不等待持久化批次刷新。
- [x] 新 Agent 只要输出标准 `AgentRunEvent`，监控页不需要增加 Agent 专属分支。
- [x] Agent Mux 不导入聊天状态、会话 hook 或 `ConversationTurn` 数据模型。
- [x] 聊天仍通过共享 Markdown 组件渲染，现有链接和图片交互回归测试通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-mux-events.test.ts src/lib/markdown-content-integration.test.ts src/lib/markdown-link.test.ts src/lib/markdown-local-file-links.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 桌面开发模式检查运行中按钮、完成态、长 Markdown、代码块及深浅主题。

## Implementation Record
- 2026-08-05T07:01:48.289Z Agent Mux 改为复用聊天的 consumeAgentRunEventStream、applyAgentRunEventToTurn 和 ConversationTurnView；标准事件立即更新独立内存 turn，连续 delta 只在 SQLite 持久化层合并；未接入聊天状态、历史或运行 hook。

- 2026-08-05T06:12:04.251Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T07:02:48.520Z `真实 codem-agent-mux Skill 长 Markdown 调用与桌面完成态截图`: 调用从 running 正常进入 completed，输出包含标题、列表、TypeScript 代码块和网页链接；完成态无取消按钮占位。运行态按钮因窗口置前工具不稳定，保留用户目视冒烟。
- 2026-08-05T07:02:34.558Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux --lib && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: Agent Mux Rust 测试 11/11 通过，结构化 payload SQLite 往返通过，格式检查通过。

- 2026-08-05T07:02:18.089Z `npm run typecheck && npm run build`: TypeScript 检查和生产构建均通过；仅有仓库既有的 chunk size 与动态导入提示。
- 2026-08-05T07:02:00.723Z `node --import tsx --test src/lib/agent-run-events.test.ts src/lib/agent-mux-events.test.ts src/lib/markdown-content-integration.test.ts src/lib/markdown-link.test.ts src/lib/markdown-local-file-links.test.ts`: 28/28 通过；标准事件、旧日志迁移、NDJSON 共用消费、delta 合并、聊天渲染接线和链接行为均通过。

- `node --import tsx --test ...`: 28/28 通过，覆盖标准/旧事件回放、流消费、delta 合并、共享渲染接线、链接与图片解析。
- `npm run typecheck`: 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux --lib`: 11/11 通过，结构化 payload SQLite 往返测试通过。
- `npm run build`: 通过；仅保留仓库既有的 chunk size 与动态导入提示。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过。
- scoped `git diff --check`: 通过，仅有既有 LF/CRLF 提示。
- 真实 Agent Mux Skill 调用生成 8 节长 Markdown、代码块和网页链接并完成落库，运行时状态从 running 正常进入 completed。
- 真实桌面完成态截图确认不保留取消按钮占位；自动化工具未能稳定把遮挡中的 CodeM 窗口置前，因此运行态按钮建议由用户再做一次目视冒烟。

## Completion Summary
- 2026-08-05T07:03:02.103Z Agent Mux 已共用聊天标准事件流、reducer、ConversationTurnView 与 MarkdownContent；实时内存 turn 和合并持久化分离，取消按钮统一为聊天停止样式，旧日志继续兼容，聊天状态保持隔离。

- Agent Mux 运行监控已复用聊天标准事件流、reducer、`ConversationTurnView` 和共享 Markdown 组件。
- 实时内存展示与 SQLite 合并持久化分离，长 delta 不再延迟到批次结束才显示。
- 取消按钮统一为聊天停止控件样式，完成态直接消失；聊天会话状态和 Agent Mux 运行状态仍保持隔离。

## Follow-ups

- 等待/审批事件的可交互闭环另行设计。
