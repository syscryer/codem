# Task: 展示 OpenCode ACP 思考输出

## Background

OpenCode 通过 ACP 返回 `agent_thought_chunk`，其中包含 Agent 明确公开的思考文本。CodeM 当前只统计 thought chunk 数量并映射成无文本的 `thinking` phase，前端又忽略 `thinking-delta`，因此用户只能看到“思考中/已处理”状态，无法像 Claude Code 一样展开查看思考过程。

## Objective

将 ACP 明确暴露的 agent_thought_chunk 映射为可折叠思考块，并保持最终回答与工具事件顺序

## Scope

In scope:

- 保留 ACP `agent_thought_chunk.content.text`，并限制单个事件文本大小。
- 将 ACP thought 映射为通用 Agent `thinking-delta` 事件。
- 将 `thinking-delta` 按事件顺序写入 `turn.items` 的 Thinking item。
- 复用现有默认折叠、可展开的 Thinking UI，并随会话历史持久化。
- 补充 Rust 事件映射、序列化和前端 reducer 回归测试。

Out of scope:

- 不读取或推断模型未通过 Agent 协议公开的隐藏思维链。
- 不修改 Claude Code、普通聊天、模型思考级别和供应商配置机制。
- 不修改 ACP 工具、审批、AI 提问和终态事件语义。

## Impact

- Backend: `src-tauri/src/acp.rs`、`agent_run.rs`、`agent_runtime.rs`。
- Frontend: `src/lib/agent-run-events.ts` 及对应测试。
- Persistence: 沿用现有 `turn.items` 历史保存，不新增数据库字段。
- Contract: 通用 Agent stream 正式发送已有前端类型中的 `thinking-delta`。

## Acceptance Criteria

- [x] ACP thought 文本按原始事件顺序进入 `thinking-delta`，不混入最终回答。
- [x] OpenCode 会话显示可折叠、可展开的 Thinking 内容。
- [x] 完成后的 Thinking 默认折叠，并能从已保存历史恢复。
- [x] 工具调用、最终回答、usage、done/error 事件不回归。
- [x] 真实 MiniMax-M3/OpenCode 渠道可以同时产生思考内容和最终回答。
- [x] Rust 完整测试、前端相关测试和类型检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node --import tsx --test src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- 使用真实 MiniMax-M3/OpenCode 渠道发送项目检查请求，确认 Thinking 可展开且最终回答正常。

## Implementation Record

- 2026-07-16T11:10:57.824Z 真实 MiniMax 验证发现 OpenCode 1.2.27 不支持 session/set_config_option，导致自定义渠道在模型切换阶段以 -32601 失败；需让渠道运行配置在 session/new 前直接声明默认 provider/model。
- 2026-07-16T10:41:52.764Z 根因确认并完成第一版实现：ACP agent_thought_chunk 原本只保留计数，AcpEventMapper 只发送 phase，前端 reducer 又忽略 thinking-delta。现已保留受限 thought text、映射 thinking-delta，并写入 Thinking timeline item，不混入 assistantText。

- 2026-07-16T10:25:30.133Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T11:17:52.995Z `真实 OpenCode 1.18.2 + MiniMax-M3 渠道流式请求`: 通过：HTTP 200；6 个非空 thinking-delta（103 字符）、7 个正文 delta（161 字符）、工具事件与 done；0 个 error。

- 2026-07-16T11:17:51.385Z `npm run typecheck`: 通过：TypeScript project build 无错误。
- 2026-07-16T11:17:49.799Z `node --import tsx --test src/lib/agent-run-events.test.ts`: 通过：5/5，公开 thought 进入 Thinking item 且不混入 assistantText。

- 2026-07-16T11:17:48.172Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 138 项、main 9 项通过；1 项需真实 Grok 登录的 smoke test 按设计忽略。
- 2026-07-16T11:17:46.531Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：最终 Rust 源码格式检查无差异。

## Completion Summary
- 2026-07-16T11:18:23.368Z 完成 OpenCode ACP 公开思考输出：保留受限 thought 文本并映射 thinking-delta，前端按事件顺序写入可折叠 Thinking item，不混入最终回答；完整 Rust/前端/类型检查与真实 OpenCode 1.18.2 + MiniMax-M3 渠道验证通过。

## Follow-ups

- 无。
