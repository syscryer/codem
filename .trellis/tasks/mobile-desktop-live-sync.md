# Task: 修复桌面运行任务移动端不可见

## Background

桌面端和移动伴侣共用 SQLite 历史，因此任务完成后移动端重新进入会话可以读取完整结果；但桌面端启动任务时，移动首页和已打开的移动会话没有可靠的运行状态通知。现有全局移动 SSE 只发送固定心跳，前端又为避免每 2 秒全量 bootstrap 而取消订阅；单会话 SSE 在进入时没有 active run 会立即结束，导致后续由桌面启动的同线程任务无法被移动端接管。

## Objective

让桌面端和移动端基于同一后端 runtime/event buffer 实时看到执行状态与增量日志；任一端发起任务，另一端都能自动发现、持续接收并在断线后补齐，同时保持桌面前端页面和状态逻辑不变。

## Scope

In scope:

- 将 `/api/mobile/events` 改为运行状态变化通知流，仅在 active runtime 集合或关键状态变化时触发移动 bootstrap。
- 移动 workspace hook 订阅状态变化 SSE，不使用固定间隔全量刷新。
- 将单线程 `/api/mobile/tasks/:threadId/events` 改成长连接，空闲时继续观察，并在桌面稍后启动任务后自动接管其事件流。
- 按 run id 隔离事件 cursor，避免新一轮运行被旧 cursor 跳过。
- 覆盖桌面发起、移动发起、任务结束、等待处理和断线重连路径的自动化与真实链路验证。

Out of scope:

- 不修改桌面端页面、路由和对话渲染组件。
- 不改变 Agent 原始事件协议或 SQLite 历史结构。
- 不恢复轮询完整 bootstrap，不增加公网中继能力。

## Impact

- Backend: `src-tauri/src/mobile_companion.rs` 的移动 SSE 聚合与桌面 runtime 接管。
- Mobile frontend: `src/mobile/hooks/useMobileWorkspace.ts`、`src/mobile/hooks/useMobileThread.ts`。
- Tests: 移动状态订阅静态约束、live event cursor 和 Rust runtime signature 单元测试。

## Acceptance Criteria

- [x] 桌面端启动任务后，移动首页无需刷新即可显示运行中/等待/失败/完成状态。
- [x] 移动端已打开同一会话时，即使打开时任务尚未开始，也能自动显示随后从桌面产生的文本 delta、Thinking、工具调用和终态。
- [x] 移动端发起任务时，桌面端现有实时对话行为不回归；两端最终历史一致。
- [x] 新 run 使用独立 cursor，旧 run 的 offset 不会跳过新事件或错误结束当前 turn。
- [x] SSE 无状态变化时只发送保活注释，不触发 bootstrap；前端不存在 `setInterval` 全量同步。
- [x] 网络中断后 EventSource 自动重连并从当前 run cursor 继续，必要时通过历史 reload 收敛。
- [x] 未修改桌面前端页面组件，移动 API 仍执行认证和脱敏。

## Verification Commands

- `node --import tsx --test src/mobile/hooks/useMobileThread.test.ts src/mobile/mobile-conversation-reuse.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`
- `npm run build`
- 重启 backend/mobile 后用真实桌面 Agent 运行验证移动首页与已打开会话实时更新。

## Implementation Record
- 2026-08-16T03:23:59.249Z 完成最终验收：真实 Tailscale 链路中桌面发起任务，移动端实时显示 prompt、Thinking、工具调用、审批及终态；批准后刷新历史仍保留，SQLite 线程已写入真实 sessionId。

- 2026-08-16T03:17:44.062Z 修复桌面发起任务的移动中继：同步 sessionId、完成回合历史、重复持久化去重，并从 Claude active run 读取本轮真实 prompt；真实 Tailscale 链路已验证桌面启动→移动实时 Thinking/工具/审批→终态→刷新历史保留。
- 2026-08-16T01:45:11.722Z 确认目标为桌面与移动端共享实时运行状态和增量日志；实现移动 runtime 变化 SSE、长连接单会话事件流、runId 游标，并为 Claude runtime 状态补充 currentRunId/phase 的只读字段，桌面前端保持不变。

- 2026-08-16T01:29:02.702Z Task created by Trellis automation.

## Verification Results
- 2026-08-16T03:23:59.756Z `node --import tsx --test src/mobile/hooks/useMobileThread.test.ts src/mobile/mobile-conversation-reuse.test.ts; npm run typecheck; cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test --manifest-path src-tauri/Cargo.toml mobile_companion; npm run build; git diff --check`: 全部通过：前端 20 项、Rust 移动伴侣 35 项，类型、格式、生产构建和 diff 检查正常；真实桌面到移动端实时同步及刷新持久化通过。

## Completion Summary
- 2026-08-16T03:24:00.268Z 完成桌面与移动端实时运行状态、增量日志、Thinking、工具、审批、终态和历史持久化同步；移动 SSE 支持新 run 接管与断线游标恢复，桌面前端保持不变。

## Follow-ups

- 无实现遗留；端到端测试使用了临时固定密码，验收后应在桌面设置中改为用户自己的密码。
