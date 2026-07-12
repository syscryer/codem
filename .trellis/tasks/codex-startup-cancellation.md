# Task: 修复 Codex 启动阶段取消竞态

## Background

浏览器验收动态模型选择时发现：Codex 刚进入“正在启动”后的极短窗口立即停止，
`turn/start` 可能已经返回 turn id，但 App Server 尚未把该 turn 标记为 active。CodeM 此时发送
`turn/interrupt` 会收到 `no active turn to interrupt`，当前协议客户端把它作为执行错误暴露到聊天。

## Objective

Codex turn/start 尚未稳定时立即停止也应可靠结束为 cancelled，不向用户暴露 no active turn to interrupt，并补协议测试后提交推送。

## Scope

In scope:

- 保留启动阶段收到的取消意图，只在 `turn/started` 明确确认 turn active 后发送 `turn/interrupt`。
- 增加 Codex JSON-RPC 协议测试，覆盖 `turn/start` 响应早于 `turn/started` 时不得提前 interrupt。
- 真实浏览器复验启动后立即停止，并完成当前模型选择改动的一并提交与双远端推送。

Out of scope:

- 不修改 Claude/Grok 取消语义、Agent SSE event contract、前端 timeline 或持久化结构。
- 不吞掉 `turn/interrupt` 或其他 Codex App Server RPC 错误。
- 不重构通用 Agent 控制状态机。

## Impact

- Backend：`src-tauri/src/codex_app_server.rs` 的 turn cancel 状态和 JSON-RPC 响应处理。
- Frontend：不改 contract；继续消费既有 `done(stopReason=cancelled)`。
- Compatibility：正常运行中取消仍只发送一次有效 interrupt；其他协议错误继续作为 error 终态。

## Acceptance Criteria

- [x] 取消早于 `turn/started` 时不会丢失，turn active 后会发送 interrupt。
- [x] `turn/start` 返回 turn id 后仍不会提前 interrupt，必须等待匹配的 `turn/started`。
- [x] 正常运行中取消、正常完成和非竞态错误行为保持不变。
- [x] 浏览器中启动后立即停止显示“已停止”，不出现协议错误。
- [x] Rust 全量测试、格式检查、前端类型/聚焦测试、生产构建与 diff 检查通过。
- [x] 仅提交任务相关文件，`.agents/` 与 `mcps/` 不进入提交。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm.cmd run typecheck`
- `node --import tsx --test src/lib/agent-model-selection.test.ts src/lib/agent-provider-registry.test.ts src/lib/multi-provider-chat-routing.test.ts`
- `npm.cmd run build`
- `git diff --check`
- 浏览器真实 Codex 启动阶段立即停止 smoke

## Implementation Record
- 2026-07-12T15:42:21.125Z 浏览器真实 smoke：Codex gpt-5.4-mini + low 发送后立即停止，先显示正在停止，随后显示已停止且无 no active turn to interrupt；临时项目与线程已删除。

- 2026-07-12T15:42:20.704Z 新增协议时序回归：取消后先返回 turn/start result 并插入非终态通知，断言不提前 interrupt；收到 turn/started 后才发送 interrupt 并等待 interrupted 终态。
- 2026-07-12T15:42:20.276Z 根因确认：turn/start 响应返回 turn id 不代表 turn 已 active；新增 turn_started 门控，取消意图只在匹配 turn/started 后发送 turn/interrupt，所有 RPC 错误仍保持可见。

- 2026-07-12T15:33:28.813Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T15:43:31.190Z `浏览器真实 Codex 启动阶段立即停止 smoke`: 通过：发送后立即停止，状态从正在停止收敛为已停止，无 no active turn to interrupt；临时项目和线程已删除。

- 2026-07-12T15:43:30.777Z `git diff --check`: 通过，无空白错误。
- 2026-07-12T15:43:30.369Z `npm.cmd run build`: 通过：2505 modules transformed；仅保留既有动态导入和 chunk-size 提示。

- 2026-07-12T15:43:29.940Z `node --import tsx --test src/lib/agent-model-selection.test.ts src/lib/agent-provider-registry.test.ts src/lib/multi-provider-chat-routing.test.ts`: 通过：21 tests，0 failed。
- 2026-07-12T15:43:29.519Z `npm.cmd run typecheck`: 通过，TypeScript 无错误。

- 2026-07-12T15:43:29.074Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过，无格式差异。
- 2026-07-12T15:43:28.652Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 40 passed / 1 ignored，main 9 passed，bin/doc 0 failed；新增启动取消时序测试通过。

## Completion Summary
- 2026-07-12T15:45:52.282Z 修复 Codex 启动阶段取消竞态：turn/start 返回 id 后不再提前 interrupt，仅在匹配 turn/started 后发送；新增协议时序测试，真实浏览器立即停止稳定收敛为已停止。模型动态选择与本修复全量门禁通过，提交范围已排除 .agents 与 mcps。

## Follow-ups

- 后续如其他 Provider 出现同类启动取消竞态，再评估抽取通用取消状态机。
