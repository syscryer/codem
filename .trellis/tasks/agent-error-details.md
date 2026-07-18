# Task: 透传 Agent 运行真实错误

## Background

Grok 系统渠道发生上游错误时，ACP 可能只返回 `-32603 Internal error`，导致对话卡片丢失真实原因；其他 ACP/Codex 传输错误也存在只显示泛化文案的路径。

## Objective

统一展示 Claude ACP、Grok、OpenCode 等 Agent 运行错误的可读详情，扩展 Grok 系统渠道日志透传，并对敏感信息做边界内脱敏。

## Scope

In scope:

- 扩展 Agent 运行态 ACP/Codex 错误事件，保留 RPC、协议、I/O、JSON、超时和执行详情。
- Grok 系统渠道从默认用户 `.grok/logs/unified.jsonl` 读取当前 session/turn 的上游失败原因。
- 统一错误详情长度限制和敏感凭据脱敏。
- 为运行错误与 Grok 系统渠道补充 Rust 回归测试。

Out of scope:

- 不改变 ACP 协议内部回调使用的通用 `public_message()`。
- 不把完整日志、请求头、API key 或 base64 内容透传到前端或历史记录。

## Impact

- 影响 `src-tauri/src/agent_run.rs` 的 Agent 运行错误事件和模型探测错误响应；前端继续消费既有 `error.message` 字段。

## Acceptance Criteria

- [x] Grok 系统渠道的当前 session/turn 上游错误可展示。
- [x] ACP/Codex 各类运行错误保留可读详情并限制长度。
- [x] 敏感凭据经过脱敏，旧的 Grok 日志 session/时间窗口过滤保持有效。
- [x] 定向 Rust 测试、TypeScript 类型检查、格式和 diff 检查通过。

## Verification Commands

- 全仓 `cargo fmt --check` 仍存在此前 `agent_channels.rs`、`automation.rs` 的格式差异，本任务未修改这些无关文件。

## Implementation Record
- 2026-07-18T14:45:01.922Z 统一 Agent 运行错误透传：ACP/Codex 的 RPC、协议、I/O、JSON、超时和执行错误保留脱敏详情；Grok 系统渠道从默认 .grok 日志读取当前 session/turn 的上游错误。

- 2026-07-18T14:36:02.163Z Task created by Trellis automation.

## Verification Results

- 2026-07-18T14:46:33.551Z `cargo test --manifest-path src-tauri/Cargo.toml`: 170 passed, 1 ignored, 0 failed；lib、bin、doc tests全部通过。
- 2026-07-18T14:45:24.134Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs; git diff --check; cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests:: -- --nocapture; npm run typecheck`: agent_run 31/31 通过，TypeScript typecheck 通过，agent_run rustfmt 与 git diff check 通过；cargo fmt 全仓仍有已有 agent_channels/automation 格式差异未改。

## Completion Summary
- 2026-07-18T14:46:44.066Z 已完成 Agent ACP/Codex 运行错误详情透传与脱敏；Grok 系统渠道支持读取默认 .grok 日志的当前 session/turn 真实上游错误；测试与桌面开发后端验证通过。

## Follow-ups

- 待补充。
