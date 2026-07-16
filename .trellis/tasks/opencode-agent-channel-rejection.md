# Task: 修复 OpenCode 自定义渠道拒绝请求

## Background

OpenCode 会话选择 CodeM 维护的 MiniMax 渠道后，首次发送消息立即显示“ACP Provider 拒绝了请求”。渠道测试和模型获取均已成功，系统 OpenCode 配置不受影响。

## Objective

定位并修复 OpenCode 使用 CodeM 自定义 Agent 渠道时 ACP 拒绝请求的问题，同时保留系统渠道与其他 Agent 机制

## Scope

In scope:

- 核对会话持久化的渠道 ID、OpenCode 渠道运行时和 ACP 启动链路。
- 确保 OpenCode ACP 子进程收到 CodeM 生成的供应商配置和临时 API Key 环境变量。
- 补充启动参数回归测试，并手工验证真实 MiniMax 渠道可以完成一次消息。

Out of scope:

- 不修改用户的系统 OpenCode 或 CC Switch 配置。
- 不调整普通聊天供应商机制、Claude Code 渠道或模型接口协议。
- 不记录、输出或提交用户 API Key。

## Impact

- Backend: `src-tauri/src/agent_run.rs` 的 ACP 子进程启动方式，以及 `src-tauri/src/agent_channels.rs` 的 OpenCode 运行时配置生成。
- Runtime: OpenCode 自定义渠道的 `OPENCODE_CONFIG_CONTENT` 与 `CODEM_AGENT_CHANNEL_API_KEY` 注入。
- Frontend/API/SQLite contract 不变。

## Acceptance Criteria

- [x] OpenCode 系统当前配置仍按原方式启动。
- [x] OpenCode CodeM 渠道通过带环境变量的 ACP 启动路径运行。
- [x] MiniMax 自定义渠道可以创建 ACP 会话、切换模型并完成一次消息。
- [x] Grok Build ACP 参数和环境注入行为不回归。
- [x] Rust 定向测试、完整 Rust 测试和前端类型检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- 使用本地 OpenCode MiniMax 渠道发送 `hi`，确认不再返回 ACP 拒绝。

## Implementation Record
- 2026-07-16T10:16:04.591Z 完成 OpenCode Anthropic URL 标准化：仅运行时将 Claude 风格 base URL 转为 AI SDK 所需的版本前缀；已带 /v1 或 /v1/messages 的地址不会重复拼接。真实 MiniMax-M3 渠道返回 status/session/phase/delta/done，0 个 error，stopReason=end_turn。

- 2026-07-16T09:51:25.996Z 第二层根因确认：OpenCode 的 @ai-sdk/anthropic 会在 baseURL 后追加 /messages；CodeM 直接传入 Claude 风格的 https://api.minimaxi.com/anthropic，实际请求 /anthropic/messages 返回 404，而 /anthropic/v1/messages 路由存在。修复限定为 OpenCode Anthropic 运行时的 URL 标准化，不修改持久化配置。
- 2026-07-16T09:40:24.577Z 根因确认：agent_channels::build_runtime 已为 OpenCode 生成 OPENCODE_CONFIG_CONTENT 与 CODEM_AGENT_CHANNEL_API_KEY，但 agent_run::spawn_acp_client 的 OpenCode 分支调用 AcpStdioClient::spawn，未传入 channel environment，导致自定义 provider/model 未加载并在 ACP set_config_option(model) 阶段被拒绝。

- 2026-07-16T09:36:05.972Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T10:16:09.479Z `真实 OpenCode MiniMax-M3 渠道最小消息`: 通过：HTTP 200；事件包含 delta 与 done；ErrorCount=0；stopReason=end_turn；临时会话已删除。
- 2026-07-16T10:16:08.337Z `node --import tsx --test src/lib/provider-template-search.test.ts`: 通过：7/7。

- 2026-07-16T10:16:07.162Z `npm run typecheck`: 通过：TypeScript project build 无错误。
- 2026-07-16T10:16:05.847Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 147 项通过（lib 138 + main 9），1 项需真实 Grok 环境的 smoke test 按设计忽略。

## Completion Summary
- 2026-07-16T10:16:10.682Z 修复 OpenCode 自定义渠道拒绝请求：ACP 启动统一透传渠道环境，Anthropic base URL 在 OpenCode 运行时标准化为 AI SDK 版本前缀；补充 Rust/前端回归测试并通过真实 MiniMax-M3 消息验证。

## Follow-ups

- 无。
