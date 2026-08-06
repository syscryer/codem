# Task: Agent Mux 会话去重与状态收口

## Background

会话上下文岛直接渲染线程关联的原始 Agent Mux run，导致同一 `threadId + profileId + workingDirectory` 会话的多轮调用重复显示。Agent Mux Runtime 重启时，旧进程中的子 Agent 已终止，但数据库中的 `running/queued` run 未收口，造成不存在的运行仍显示“运行中”。

## Objective

同一子 Agent 会话在上下文岛只显示一条，并清理已被后续轮次取代的运行中残留状态

## Scope

In scope:

- 上下文岛复用现有 Agent Mux 会话分组函数，每个会话仅展示最新 run。
- 专用 Agent Mux Runtime 启动时，将上次进程遗留的 `running/queued` run 标记为中断失败。
- 保留 `waiting` 与已有终态，不覆盖已有运行摘要。

Out of scope:

- 不合并不同线程、profile 或工作区的调用。
- 不改变运行监控详情中的多轮时间线。
- 不尝试恢复已随旧 Runtime 终止的底层子进程。

## Impact

- `src/components/ConversationContextPrototype.tsx` 的 Agent Mux 列表和计数。
- `src-tauri/src/agent_mux.rs` 与专用 `codem-agent-mux serve` 的启动恢复。

## Acceptance Criteria

- [ ] 同一会话的三轮调用在上下文岛只显示一条，点击仍可查看完整多轮详情。
- [ ] 最新轮已完成时，会话不显示为运行中。
- [ ] Runtime 重启后遗留的 `running/queued` 状态持久化为失败，并写入中断说明。
- [ ] `waiting/completed/failed/cancelled` 状态不被启动恢复误改。

## Verification Commands

- `node --import tsx --test src/lib/agent-mux-conversations.test.ts src/lib/conversation-context-prototype.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `npm run typecheck`
- 重启桌面开发模式并验证真实“小猫”会话只显示一条且无残留运行中状态。
- `git diff --check`

## Implementation Record
- 2026-08-06T09:15:16.563Z 确认截图中三条小猫 run 的 threadId、profileId、workingDirectory、sessionId 完全一致。上下文岛改为复用 groupAgentMuxRunsByConversation，每个会话只显示最新 run；专用 Runtime serve 启动时把旧进程遗留的 running/queued 标记为 failed，并保留 waiting 与终态。

- 2026-08-06T09:08:14.281Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T09:17:31.630Z `npm run typecheck && npm run build && cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: pass
- 2026-08-06T09:17:24.894Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass: 10 tests

- 2026-08-06T09:17:13.579Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests::reconcile_interrupted_runs_marks_only_active_runs_failed`: pass: 1 test
- 2026-08-06T09:17:05.288Z `node --import tsx --test src/components/conversationContextModel.test.ts src/lib/agentMuxConversations.test.ts`: pass: 9 tests

## Completion Summary
- 2026-08-06T09:17:38.995Z 修复会话上下文岛重复展示同一 Agent Mux 会话，并在 Runtime 启动时将遗留 running/queued 任务恢复为 failed；前后端回归、类型检查、构建和格式检查均通过。

## Follow-ups

- 暂无。
