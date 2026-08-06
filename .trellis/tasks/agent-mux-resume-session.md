# Task: Agent Mux 子会话续用

## Background

Agent Mux 当前每次 `invoke` 都创建新的 Provider 会话。主 Agent 再次要求同一子 Agent 返工时，子 Agent 无法看到上一轮上下文，只能从头执行。

## Objective

允许主 Agent 使用已有子 Agent sessionId 继续返工，同时保持首次调用新建会话

## Scope

In scope:

- 持久化 Agent Mux 运行实际返回的 `sessionId`。
- 同一 CodeM 主会话、同一运行配置、同一工作区再次调用时，自动复用最近一次可续用的子会话。
- 将复用的 `sessionId` 传给 Claude 与通用 Agent 运行接口。
- 在 Agent Mux Skill 说明中明确自动续用规则。
- 补充最小单元测试，覆盖命中与隔离边界。

Out of scope:

- 默认权限下的审批透传。
- Agent Mux 页面上的手工选择、分叉或合并子会话 UI。
- 跨主会话、跨运行配置或跨工作区自动共享子会话。
- 新增独立会话管理服务。

## Impact

- `src-tauri/src/agent_mux.rs`：运行记录 schema/API 增加 `sessionId`。
- `src-tauri/src/bin/codem-agent-mux.rs`：选择可续用会话、传递并保存 Provider `sessionId`。
- `src/lib/agent-mux-api.ts`、`src/components/AgentMuxPrototype.tsx`：同步类型和 Skill 使用说明。

## Acceptance Criteria

- [x] 首次调用未命中旧记录时创建新 Provider 会话。
- [x] Provider 返回的有效 `sessionId` 会保存到当前 Agent Mux 运行记录。
- [x] 同一 `threadId + profileId + workingDirectory` 的后续调用自动携带最近的 `sessionId`。
- [x] 主会话、运行配置或工作区任一不同均不会自动续用。
- [x] 外层完全访问向子 Agent 继承的现有行为保持不变。
- [x] `status --json` 可查看运行记录的 `sessionId`。

## Verification Commands

- `cargo test --bin codem-agent-mux`
- `cargo test agent_mux --lib`
- `cargo fmt --all -- --check`
- `npm run typecheck`
- `npm run build`

## Implementation Record

- 2026-08-06T05:58:19.296Z 已实现主会话 threadId + Agent profileId + workingDirectory 自动续用最近非运行中子会话；Provider sessionId 持久化并透传 Claude/通用 Agent，完全访问继承保持不变。
- 2026-08-06T05:48:39.825Z 确定最小续用策略：同一 CodeM threadId、profileId 与 workingDirectory 自动复用最近终态运行的 sessionId；跨边界调用新建会话。运行记录持久化 Provider 实际 sessionId。

- 2026-08-06T05:40:41.236Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T05:58:23.410Z `真实 Agent Mux 两轮同会话调用`: 通过：第二轮读取到首轮 RSM-8427；两条运行 sessionId 均为 46a9814e-d2f0-4c71-92d1-fb580950a4f5，状态均 completed
- 2026-08-06T05:58:22.733Z `npm run build`: 通过

- 2026-08-06T05:58:22.036Z `npm run typecheck`: 通过
- 2026-08-06T05:58:21.353Z `cargo fmt --all -- --check`: 通过

- 2026-08-06T05:58:20.640Z `cargo test agent_mux --lib`: 通过：16/16
- 2026-08-06T05:58:19.952Z `cargo test --bin codem-agent-mux`: 通过：8/8

## Completion Summary
- 2026-08-06T05:58:56.238Z Agent Mux 已支持同一 CodeM 主会话、同一 Agent 配置和同一工作区自动续用子 Agent 会话；真实两轮返工验证已确认上下文和 sessionId 均复用，完全访问继承保持不变。

## Follow-ups

- 仅在出现真实需求时再增加手工新建、切换或分叉子会话能力。
