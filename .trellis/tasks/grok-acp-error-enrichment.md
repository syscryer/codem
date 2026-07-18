# Task: 补充 Grok ACP 上游错误

## Background

Grok Build 0.2.x 在上游渠道返回 404、429、500 或 502 时，ACP 有时只返回
`RPC -32603: Internal error`，但会把真实上游状态写入当前 `GROK_HOME` 下的
`logs/unified.jsonl`。CodeM 已经完整展示 ACP message，但泛化错误无法帮助用户
判断是接口类型、模型还是渠道限流。

## Objective

当 Grok ACP 仅返回 Internal error 时，从渠道隔离日志安全补充当前会话的真实上游错误

## Scope

In scope:

- 仅对 Grok Build 的泛化 `-32603 Internal error` 做错误增强。
- 仅读取 CodeM 为当前渠道创建的隔离 `GROK_HOME` 日志。
- 同时按 ACP `sessionId` 和本轮开始时间匹配 `turn.terminal_failure` 或
  `shell.turn.inference_failed`。
- 只展示上游错误首行，并对 token、API key、Bearer 等敏感片段脱敏。
- 日志缺失、匹配失败或内容不安全时保留原始 ACP 错误。

Out of scope:

- 不读取用户全局 `~/.grok` 日志。
- 不改变 Claude、Codex、OpenCode 或普通聊天错误链路。
- 不新增前端事件类型、弹窗或持久化字段。
- 不把历史会话或其他渠道日志作为当前错误兜底。

## Impact

- `src-tauri/src/agent_run.rs`：Grok ACP runtime 错误增强、日志尾部读取和脱敏。
- 现有 `AgentRunEvent::Error` contract 与前端消费逻辑保持不变。

## Acceptance Criteria

- [x] 匹配当前 Grok session 和本轮时间窗口时，`Internal error` 展示真实上游状态。
- [x] 其他 Agent、非泛化 ACP 错误、错 session 和旧日志均不受影响。
- [x] 日志读取有固定大小上限，不在热路径持续扫描完整日志。
- [x] API key、Bearer token、长疑似 secret 不进入用户可见错误或历史记录。
- [x] 后端定向测试、格式检查和 diff 检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`
- `git diff --check`

## Implementation Record

- 2026-07-18T11:33:15.523Z 真实 Grok 请求已验证前端错误事件可直接收到上游 401 Unauthorized；泛化 RPC -32603 的当前渠道日志反查路径由 4 个定向测试覆盖。
- 2026-07-18T11:27:51.931Z 已实现 Grok ACP 泛化错误增强：仅从当前 CodeM 渠道 GROK_HOME 的日志尾部按 sessionId 和本轮时间匹配真实上游错误，并在进入 error event 前脱敏。

- 2026-07-18T11:22:46.695Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T11:33:13.688Z `git diff --check`: pass: only existing CRLF conversion warnings

- 2026-07-18T11:33:11.608Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`: pass
- 2026-07-18T11:33:10.505Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: pass: 28 passed, 0 failed

## Completion Summary
- 2026-07-18T11:33:16.956Z Grok ACP 泛化 Internal error 现在会从当前 CodeM 渠道隔离日志中按 session 和本轮时间提取并脱敏真实上游错误；直接 ACP 错误保持原样透传。

## Follow-ups

- Grok ACP 若后续原生透传结构化 upstream error，可删除日志增强分支并直接消费协议字段。
