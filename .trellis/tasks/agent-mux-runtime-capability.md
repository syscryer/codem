# Task: 修复 Agent Mux Claude Code 独立调用

## Background

Agent Mux 将已启用的 Claude Code 渠道 profile 标记为 `available`，但独立 CLI `invoke` 始终调用通用 `/api/agents/run`。该入口尚未实现 Claude driver，因此调用在创建 Agent Mux 记录后被后端拒绝，造成“可选但必然失败”。

## Objective

让可选的 Claude Code profile 能被 Agent Mux 正确调用，并让发现状态反映真实独立运行能力。

## Scope

In scope:

- Claude Code profile 的 Agent Mux 独立调用复用现有 `/api/claude/run`、渠道认证和 stream-json 事件解析。
- 每次 Claude Agent Mux 调用使用内部临时 runtime ID，不把调用方的 CodeM thread ID 传给 Claude，避免污染主会话。
- Claude 调用结束后关闭临时 runtime；取消操作走 Claude 的既有取消接口。
- 更新已安装的 Agent Mux Skill，使其不再宣称 Claude Code 不支持独立调用。
- 为请求路由和隔离 ID 增加最小回归测试。

Out of scope:

- 不把 Claude 的持续热会话、审批/追问交互扩展到 Agent Mux Skill。
- 不重写或复制 Claude stream-json 解析器，不改普通聊天运行路径。
- 不改变 Codex、Grok、Pi、OpenCode 的 Agent Mux 调用语义。

## Impact

- `src-tauri/src/bin/codem-agent-mux.rs`：按 provider 选择已有运行入口，处理临时 Claude runtime 的关闭和取消。
- Agent Mux Skill source 与已安装副本：同步真实支持范围。

## Acceptance Criteria

- [x] `claude-code` 的 `available` profile 能通过 `codem-agent-mux invoke` 返回真实完成结果。
- [x] Claude 请求使用内部 `agent-mux-*` runtime ID，不继承调用方会话 ID。
- [x] Claude 运行完成或取消后不残留临时 runtime。
- [x] 现有非 Claude provider 的请求路径保持不变。
- [x] Agent Mux Skill 的能力说明与真实调用能力一致。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem --bin codem-agent-mux`
- `codem-agent-mux invoke --profile <claude-profile> ...` 真实只读连通性调用

## Implementation Record
- 2026-08-06T03:45:58.062Z 修复 Agent Mux 取消与 Provider 失败收尾的终态竞态：cancelled 可覆盖 failed/waiting，但不覆盖 completed/已取消；同步 Agent Mux Skill 的 Claude Code 能力说明。

- 2026-08-06T03:06:51.609Z Task created by Trellis automation.

## Verification Results
- 2026-08-06T03:53:22.381Z `codem-agent-mux agents/invoke/cancel/status（Claude Code profile）`: 真实调用完成，真实取消最终 status=cancelled；providerRunId 已保存

- 2026-08-06T03:53:21.592Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem --bin codem-agent-mux`: 通过，仅有既有 dead_code/linker warnings
- 2026-08-06T03:53:20.854Z `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_mux`: 16/16 通过，包含取消竞态回归用例

- 2026-08-06T03:53:20.137Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: 6/6 通过
- 2026-08-06T03:53:19.431Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

## Completion Summary
- 2026-08-06T03:53:51.960Z Claude Code Agent Mux 独立调用、临时 runtime 隔离与取消终态竞态修复完成；已通过 Rust 测试、格式检查、编译检查和真实完成/取消调用验证。

## Follow-ups

- None.
