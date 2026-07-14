# Task: 普通聊天展示模型思考内容

## Background

普通聊天已经复用 Agent 对话的“已处理 / tokens”进度行和中间过程折叠 UI，但供应商协议层只提取最终文本与工具调用。MiniMax 等模型即使通过 API 返回 `reasoning_content` 或 Anthropic `thinking_delta`，当前链路也会丢弃，因此界面只能显示 token 统计，无法展开查看供应商公开的思考内容。

## Objective

接入供应商返回的 reasoning/thinking 流，完成实时展示、折叠交互和历史恢复

## Scope

In scope:

- 解析 OpenAI Chat 兼容接口返回的 `reasoning_content` / `reasoning` 增量。
- 解析 OpenAI Responses 的 reasoning summary 增量。
- 解析 Anthropic Messages 的 `thinking_delta`。
- 区分 Gemini `thought: true` 内容与最终回答。
- 新增稳定的普通聊天 `thinking-delta` 事件，实时写入 assistant timeline。
- 将供应商公开的思考文本持久化到普通聊天消息，并在刷新、重连和历史切换后恢复。
- 复用现有中间过程折叠交互，不新增独立浮层或第二套消息布局。
- 普通聊天始终展示“思考”摘要行，正文按 CC 样式默认折叠并可单独展开。
- 普通聊天不使用 Agent 的整体中间过程折叠策略，避免思考入口被整个隐藏。
- 对已识别的 MiniMax Token Plan `MiniMax-*` 模型自动开启供应商 thinking。
- 补充协议解析、存储和前端映射测试。

Out of scope:

- 不展示或推断供应商没有返回的隐藏思维链。
- 不改变 Agent 会话对 `thinking-delta` 的现有隐私策略。
- 本次不新增用户可配置的思考预算、推理强度或模型能力配置项。
- 不为不支持 reasoning 的模型伪造“思考”内容。

## Impact

- Frontend：普通聊天事件消费、历史到 `ConversationTurn` 的映射、思考折叠内容。
- Backend：多协议 SSE 解析、普通聊天运行事件与最终结果。
- Persistence：`ai_messages` 增加可迁移的 reasoning 文本字段。
- Compatibility：旧数据库自动补列，旧消息保持无思考内容。

## Acceptance Criteria

- [x] 供应商返回 reasoning 时，普通聊天实时出现可展开的思考内容，最终回答仍单独渲染。
- [x] 完成后刷新页面或切换会话，思考内容仍可恢复。
- [x] OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini 的公开思考字段均不会混入最终回答。
- [x] 不返回 reasoning 的模型维持当前展示，不出现空“Thinking”块。
- [x] 普通聊天默认显示“思考 + 字符数”摘要，点击摘要可展开正文。
- [x] 普通聊天的单层思考折叠不改变 Claude Code Agent 的既有展示设置。
- [x] MiniMax Token Plan 的 MiniMax 模型请求会开启 thinking，其他 Anthropic 兼容厂商不受影响。
- [x] Agent 会话仍忽略隐藏 `thinking-delta`，行为不变。
- [x] 类型检查、Rust 普通聊天测试和差异检查通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/ordinary-chat-reasoning.test.ts src/lib/agent-run-events.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `git diff --check`
- 桌面版使用支持 reasoning 的模型验证实时展开与刷新恢复。

## Implementation Record
- 2026-07-14T09:52:28.408Z 根据用户手工验收反馈，普通聊天改为 CC 风格单层折叠：思考摘要始终可见，正文默认折叠；Agent 展示与事件机制保持原样。

- 2026-07-14T17:50:00+08:00 根据手工验收反馈改为 CC 风格单层折叠：普通聊天始终显示中文“思考”摘要，正文默认折叠；Agent 展示保持不变。
- 2026-07-14T09:32:52.074Z 普通聊天默认折叠已完成思考，Agent 继续遵循原全局中间过程设置；即使供应商不返回 usage，也保留可展开入口。
- 2026-07-14T09:19:31.176Z 普通聊天与 Agent 保持独立事件链；移除思考内容的第二层折叠，展开已处理后直接展示正文；仅为 MiniMax Token Plan 的 MiniMax 模型开启 thinking。

- 2026-07-14T08:49:33.441Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T09:52:34.833Z `真实 MiniMax-M3 普通聊天流验证`: 收到 10 个 thinking-delta，共 407 字符；持久化 reasoning 长度一致，最终答案单独保存

- 2026-07-14T09:52:33.862Z `git diff --check`: 通过，仅有现有 LF/CRLF 提示
- 2026-07-14T09:52:32.962Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

- 2026-07-14T09:52:32.072Z `cargo check --manifest-path src-tauri/Cargo.toml`: 通过
- 2026-07-14T09:52:31.155Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: 38 项通过

- 2026-07-14T09:52:30.226Z `node --import tsx --test src/lib/ordinary-chat-reasoning.test.ts src/lib/agent-run-events.test.ts`: 7 项通过，包含普通聊天历史恢复与通用 Agent 隐藏 thinking 回归
- 2026-07-14T09:52:29.278Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-14T09:52:35.757Z 普通聊天已接入四类供应商公开 reasoning 流、实时事件和历史持久化；MiniMax Token Plan 自动开启 thinking；普通聊天使用中文思考摘要的 CC 风格单层折叠，Agent 机制与展示保持独立。

## Follow-ups

- 后续如需思考预算或推理强度，单独基于模型 capability 设计配置和请求映射。
