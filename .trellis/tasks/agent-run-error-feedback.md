# Task: 统一 Agent 运行错误展示

## Background

Grok Build 通过 ACP 调用自定义渠道时，上游先后返回空流和 429 限流，但会话只显示“已停止”。Claude 的异常流结束路径已按失败处理，通用 Agent 链路仍会把未收到终止事件的 EOF 当作停止；同时 ACP 的运行错误只返回通用提示，丢失上游可读原因。

## Objective

当 Claude、Codex、Grok、OpenCode 运行因渠道、CLI 或流异常失败时，前端展示可读错误原因；用户主动停止仍显示已停止，并补齐跨层回归测试。

## Scope

In scope:

- 统一 Claude、Codex、Grok Build、OpenCode 的异常结束语义。
- Grok Build 与 OpenCode 的 ACP RPC/协议运行错误保留有界的可读详情。
- 通用 Agent 非主动取消的事件流 EOF 标记为失败并展示原因。
- 用户主动停止继续显示“已停止”。

Out of scope:

- 不改变渠道重试、限流或模型路由策略。
- 不自动重试失败请求。
- 不修改 Agent CLI 自身日志格式。

## Impact

- Frontend: `src/hooks/useAgentRun.ts`、通用 Agent 事件归并测试。
- Backend: `src-tauri/src/agent_run.rs` 的 ACP 运行错误映射。
- Persistence: 错误状态和可读错误文案继续通过现有会话历史持久化，不新增字段。

## Acceptance Criteria

- [x] ACP RPC 错误在会话中展示状态码/上游原因等可读详情，并限制最大长度。
- [x] Grok Build、OpenCode、Codex 的非主动取消 EOF 显示失败，而不是“已停止”。
- [x] 用户主动停止仍显示“已停止”。
- [x] Claude 原有错误事件与异常 EOF 行为保持不变。
- [x] 前端错误文案可从历史卡片继续回显。

## Verification Commands

- `node --import tsx --test src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `cargo test public_acp_error_keeps_bounded_rpc_detail_for_agent_runs --manifest-path src-tauri/Cargo.toml`
- `cargo test acp_rpc_error_points_to_channel_configuration_without_exposing_details --manifest-path src-tauri/Cargo.toml`
- `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`
- `git diff --check`

## Implementation Record
- 2026-07-18T07:35:50.234Z 统一 Agent 错误展示：通用 Agent 的非主动取消 EOF 进入失败态，ACP 运行错误保留截断后的 RPC/协议详情；补充前后端回归断言。

- 2026-07-18T07:29:12.535Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T07:42:07.821Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs && git diff --check`: 通过：本次 Rust 文件格式正确，diff 无空白错误。

- 2026-07-18T07:42:07.452Z `cargo test public_acp_error_keeps_bounded_rpc_detail_for_agent_runs --manifest-path src-tauri/Cargo.toml && cargo test acp_rpc_error_points_to_channel_configuration_without_exposing_details --manifest-path src-tauri/Cargo.toml`: 通过：ACP 运行详情与原有安全提示测试各 1/1。
- 2026-07-18T07:42:07.131Z `node --import tsx --test src/lib/agent-run-events.test.ts && npm run typecheck`: 通过：通用 Agent 事件测试 7/7，TypeScript typecheck 通过。

- 前端通用 Agent 事件测试 7/7 通过。
- TypeScript typecheck 通过。
- ACP 运行错误详情与原有安全提示测试均通过。
- `src-tauri/src/agent_run.rs` 定向 rustfmt 检查通过。
- `git diff --check` 通过，仅有工作区既有 CRLF 提示。
- Web `http://127.0.0.1:5173/api/agents/providers` 经 3002 后端代理返回 200。

## Completion Summary
- 2026-07-18T07:42:08.156Z 统一 Agent 运行错误反馈：Grok/OpenCode ACP 运行保留有界 RPC/协议详情，Codex/ACP 通用链路的异常 EOF 显示失败，主动停止保持已停止；Claude 原有行为核对无回归。

通用 Agent 不再把异常 EOF 误显示为停止；ACP 运行错误会把有界的 RPC/协议详情传到现有错误卡片。Claude、Codex、Grok Build、OpenCode 的错误收口已核对，主动停止语义未改变。

## Follow-ups

- 待补充。
