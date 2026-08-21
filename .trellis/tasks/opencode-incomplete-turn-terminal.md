# Task: 修复 OpenCode 会话无响应静默完成

## Background

OpenCode 会话 `ses_fddb9f8bcffeW1DcLrQ481RAd9` 的一轮执行在最后一条 assistant
消息仅产生 thought、没有最终公开文本时结束。OpenCode 内部记录 `finish=unknown`，但其
ACP 适配层返回 `stopReason=end_turn`，CodeM 因而发出 `done`，界面没有显示错误。

## Objective

识别 OpenCode ACP 异常结束并通过现有 error 终态暴露为可重试失败，避免缺少最终回复时落为 done

## Scope

In scope:

- 在通用 ACP 流中按 `messageId` 跟踪最后一条 assistant 消息是否产生公开文本。
- `end_turn` 对应的最后一条 assistant 消息没有公开文本时，返回明确的可重试错误。
- 保留可用的 ACP 热会话，并复用现有 `error` terminal event 和前端重试行为。
- 增加 ACP 终态与运行错误分类回归测试。

Out of scope:

- 修改 OpenCode 上游实现或模型 Provider。
- 新增前端 event 类型、状态或兜底文案。
- 将所有无文本响应判错；缺少 `messageId` 时维持现有兼容行为。

## Impact

- Backend: `src-tauri/src/acp.rs`、`src-tauri/src/agent_run.rs`。
- Frontend contract: 不变，继续消费现有 `error` terminal event。
- Runtime: 异常轮次结束，但可用的 ACP 热会话不关闭，队列保留等待用户重试。

## Acceptance Criteria

- [x] `end_turn` 且最后 assistant `messageId` 只有 thought/tool、没有公开文本时不再返回成功。
- [x] 同一条 assistant 消息包含 thought 和公开文本时仍正常 `done`。
- [x] 取消、拒绝、超长输出和缺少 `messageId` 的兼容路径不受影响。
- [x] 不完整终态映射为非致命 `error`，ACP 热会话保持可继续。
- [x] 错误信息包含真实 `stopReason` 和最后消息 id，便于诊断。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml acp_prompt_`
- `cargo test --manifest-path src-tauri/Cargo.toml incomplete_acp_turn`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- 重启 `npm run desktop:dev` 后检查 `/api/health`。

## Implementation Record
- 2026-08-21T07:46:38.115Z 根因修复采用 ACP messageId 终态校验：end_turn 时最后 assistant 消息若只有 thought/tool、没有公开文本，返回 IncompleteTurn；agent_run 将其作为非致命 error，保留热会话并复用现有重试 UI。

- 2026-08-21T07:39:43.389Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T08:07:45.263Z `desktop dev restart and runtime health`: pass: debug codem PID 13772, dev mux PID 55432; ports 5173/52949/3210 listening; /api/health returned expected 401 auth response

- 2026-08-21T08:07:44.657Z `rtk cargo fmt --manifest-path src-tauri/Cargo.toml --check; rtk npm run typecheck; rtk git diff --check`: pass: formatting, TypeScript and whitespace checks passed
- 2026-08-21T08:07:44.044Z `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --quiet`: pass: all suites passed (578/14/21/0/0, 1 ignored), exit 0

- 2026-08-21T08:07:43.396Z `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml incomplete_acp_turn --quiet`: pass: 1 passed, 0 failed
- 2026-08-21T08:07:42.783Z `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml acp_prompt_ --quiet`: pass: 6 passed, 0 failed

## Completion Summary
- 2026-08-21T08:07:53.164Z OpenCode ACP 现在会把仅有 thought/tool、缺少最终公开文本的 end_turn 判定为可重试的非致命 error，保留热会话；回归测试、全量 Rust 测试、格式、类型检查、桌面重启和运行态健康检查均通过。

## Follow-ups

- 将 OpenCode 的 `finish=unknown` 上报上游；CodeM 本次修复不依赖上游发布时间。
- 2026-08-21 correction: 该任务中的 `IncompleteTurn` / `messageId` 判定已被真实 OpenCode
  多步骤会话推翻并撤销。现行处理见 `opencode-network-error-terminal.md`：ACP 终态以协议响应为准，
  实际根因通过升级 OpenCode CLI 1.18.20 的 network-error 修复处理。
