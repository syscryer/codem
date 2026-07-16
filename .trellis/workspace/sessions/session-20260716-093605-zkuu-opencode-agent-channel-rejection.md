# Session Record: 修复 OpenCode 自定义渠道拒绝请求

- Session: session-20260716-093605-zkuu
- Started: 2026-07-16T09:36:05.970Z
- Task: .trellis/tasks/opencode-agent-channel-rejection.md

## Notes
- 2026-07-16T10:16:04.591Z 完成 OpenCode Anthropic URL 标准化：仅运行时将 Claude 风格 base URL 转为 AI SDK 所需的版本前缀；已带 /v1 或 /v1/messages 的地址不会重复拼接。真实 MiniMax-M3 渠道返回 status/session/phase/delta/done，0 个 error，stopReason=end_turn。

- 2026-07-16T09:51:25.996Z 第二层根因确认：OpenCode 的 @ai-sdk/anthropic 会在 baseURL 后追加 /messages；CodeM 直接传入 Claude 风格的 https://api.minimaxi.com/anthropic，实际请求 /anthropic/messages 返回 404，而 /anthropic/v1/messages 路由存在。修复限定为 OpenCode Anthropic 运行时的 URL 标准化，不修改持久化配置。
- 2026-07-16T09:40:24.577Z 根因确认：agent_channels::build_runtime 已为 OpenCode 生成 OPENCODE_CONFIG_CONTENT 与 CODEM_AGENT_CHANNEL_API_KEY，但 agent_run::spawn_acp_client 的 OpenCode 分支调用 AcpStdioClient::spawn，未传入 channel environment，导致自定义 provider/model 未加载并在 ACP set_config_option(model) 阶段被拒绝。

- 2026-07-16T09:36:05.973Z Session started.

## Verification

- 2026-07-16T10:16:09.479Z `真实 OpenCode MiniMax-M3 渠道最小消息`: 通过：HTTP 200；事件包含 delta 与 done；ErrorCount=0；stopReason=end_turn；临时会话已删除。
- 2026-07-16T10:16:08.337Z `node --import tsx --test src/lib/provider-template-search.test.ts`: 通过：7/7。

- 2026-07-16T10:16:07.162Z `npm run typecheck`: 通过：TypeScript project build 无错误。
- 2026-07-16T10:16:05.847Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 147 项通过（lib 138 + main 9），1 项需真实 Grok 环境的 smoke test 按设计忽略。

## Completed

- 2026-07-16T10:16:10.682Z 修复 OpenCode 自定义渠道拒绝请求：ACP 启动统一透传渠道环境，Anthropic base URL 在 OpenCode 运行时标准化为 AI SDK 版本前缀；补充 Rust/前端回归测试并通过真实 MiniMax-M3 消息验证。
