# Task: 统一 Agent 计划进度接入

## Background

会话上下文岛当前只扫描活动 turn 中最新的 Claude `TodoWrite` 工具输入，Codex、Grok、OpenCode、Pi 的结构化计划无法展示，Claude 新版 Task 系列也没有统一投影。Provider onboarding 规范已经要求 Driver/Runtime 归一结构化计划，前端不得按 Provider 分支。

## Objective

依次接入 Codex、Grok、OpenCode、Claude 和 Pi 的结构化计划到会话上下文岛

## Scope

In scope:

- 新增 Provider 中立的计划快照与 `plan-updated` Agent 运行事件。
- 依次接入 Codex `turn/plan/updated`、Grok `TodosUpdated`、OpenCode `todowrite`、Claude `TodoWrite`/Task 系列和 Pi 扩展结构化计划工具。
- 实时事件、Agent Mux SQLite 事件重放、会话历史持久化和页面刷新使用同一快照结构。
- 上下文岛只读取活动 turn 的统一计划快照；最新计划全部完成后隐藏且不回退旧计划。
- 对步骤数量、字符串长度和可选元数据做边界限制与脱敏后的结构化序列化。

Out of scope:

- 不从普通回复、思考文本、终端输出或 Pi widget 文案猜测计划。
- 不修改 Provider 全局配置、登录状态或 CLI 自身持久化文件。
- 不为 Pi 伪造基础能力；仅在扩展实际返回结构化计划时运行时识别。

## Impact

- `src-tauri/src/agent_runtime.rs`
- `src-tauri/src/codex_app_server.rs`
- `src-tauri/src/acp.rs`
- `src-tauri/src/agent_run.rs`
- `src-tauri/src/backend.rs`
- `src/types.ts`
- `src/lib/agent-run-events.ts`
- `src/App.tsx`
- 相关 Rust/TypeScript 回归测试

## Acceptance Criteria

- [x] Codex 原生计划通知生成统一快照并进入活动 turn。
- [x] Grok 结构化 Todo 消息不再静默丢弃，而是生成统一快照。
- [x] OpenCode ACP `todowrite` 的 `rawInput.todos` 生成统一快照。
- [x] Claude `TodoWrite` 及 Task 系列的结构化输入/输出生成或更新统一快照。
- [x] Pi 仅对扩展暴露的结构化 todo/plan 工具运行时生成统一快照。
- [x] 上下文岛无 Provider 分支，全部完成后隐藏且不回退旧计划。
- [x] 统一事件可经 Agent Mux SQLite 重放和 thread history 往返恢复。
- [x] 五个 Provider 的解析、共享 reducer、岛内展示和持久化边界都有自动化覆盖。

## Verification Commands

- `node --import tsx --test src/lib/agent-run-events.test.ts src/lib/agent-mux-events.test.ts src/lib/conversation-context-prototype.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_plan --lib`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `git diff --check`

## Implementation Record
- 2026-08-08T09:00:16.800Z 统一 AgentPlanSnapshot/AgentPlanStep 与 AgentRunEvent::PlanUpdated，实时流、Agent Mux SQLite 重放、history 持久化、turn.plan 和上下文岛共用同一快照；完成计划隐藏且不回退旧计划，前端不按 Provider 分支。

- 2026-08-08T09:00:16.165Z 已按 Codex -> Grok -> OpenCode -> Claude -> Pi 顺序接入结构化计划：Codex turn/plan/updated、Grok TodosUpdated、OpenCode ACP todowrite rawInput.todos、Claude TodoWrite/Task 系列、Pi 仅识别扩展工具返回的结构化 todos/plan/steps。
- 2026-08-08T08:39:05.123Z 已完成统一 plan-updated 数据链：Codex turn/plan/updated、Grok TodosUpdated、OpenCode ACP todowrite、Claude TodoWrite/Task 系列和 Pi 扩展结构化计划均在 Driver/Runtime 层归一；前端 turn.plan、岛内展示、完成收起、Agent Mux 重放和 history 持久化共用同一结构。

- 2026-08-08T07:41:24.066Z Task created by Trellis automation.

## Verification Results

- 2026-08-08T09:00:19.551Z `桌面开发重启与 Agent Mux Runtime identity`: 已重启 npm run desktop:dev；CodeM 窗口运行，Dev Agent Mux discovery 为 version 0.1.22，/api/runtime/identity 返回 protocolVersion=1；未执行真实五 Provider 生成，认证/外部 CLI 触发仍按 supported/runtime-detected 边界待实际环境验收
- 2026-08-08T09:00:18.843Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem; npm run build`: onboarding 门禁 69 个前端测试、13 个 Runtime 测试、5 个自动化测试全部通过，production build 成功

- 2026-08-08T09:00:18.187Z `npm run typecheck; cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check; cargo test --manifest-path src-tauri/Cargo.toml agent_plan --lib; git diff --check`: TypeScript、Rust 格式、7 个 agent_plan 测试和 diff check 全部通过
- 2026-08-08T09:00:17.446Z `node --import tsx --test src/lib/agent-run-events.test.ts src/lib/agent-mux-events.test.ts src/lib/conversation-context-prototype.test.ts src/lib/conversation-plan.test.ts`: 27 passed, 0 failed

## Completion Summary
- 2026-08-08T09:01:35.515Z 已按顺序完成 Codex、Grok、OpenCode、Claude、Pi 的结构化计划接入，统一 PlanUpdated 快照贯通实时流、Agent Mux、历史持久化和上下文岛；27 个聚焦测试、完整 onboarding 门禁、TypeScript、Rust、build 与桌面 Dev Runtime 验证通过。真实五 Provider CLI 计划触发仍按 supported/runtime-detected 边界在实际认证环境验收。

## Follow-ups

- 真实 CLI 验收中如 Provider 当前版本不触发计划事件，按 `supported` / `runtime-detected` 边界记录，不从文本补偿。
