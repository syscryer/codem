# Task: 支持 Grok 第三方渠道免官方登录

## Background

待补充背景。

## Objective

使用 CodeM Agent 渠道 API Key 时跳过 Grok cached_token 登录要求并完成 ACP 会话

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- 2026-07-18T13:44:21.328Z aijws Key 与模型有效；失败日志显示第三方流式响应偶发缺少 id，Grok 0.2.103 报 serialization/RPC -32603。CodeM 仅在无任何文本、思考或工具事件时自动重试一次。
- 2026-07-18T13:14:31.590Z Grok ACP 初始化现在区分系统渠道与 CodeM 第三方渠道：第三方渠道存在 CODEM_AGENT_CHANNEL_API_KEY 时不再强制 cached_token/grok login，直接使用渠道 API Key。

- 2026-07-18T13:14:20.927Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T13:44:21.340Z `cargo test --features custom-protocol grok_channel_internal_error_retries_only_before_runtime_activity`: pass

- 2026-07-18T13:44:21.336Z `git diff --check`: pass
- 2026-07-18T13:44:21.332Z `Direct OpenAI Chat non-stream and stream requests`: both returned pong with valid id fields during verification

- 2026-07-18T13:44:21.323Z `Agent channel test aijws`: 连接成功，发现 6 个模型
- 2026-07-18T13:14:31.597Z `git diff --check`: pass

- 2026-07-18T13:14:31.592Z `cargo test --features custom-protocol grok_channel_credentials_skip_cached_login_requirement`: pass
- 2026-07-18T13:14:31.586Z `POST /api/agents/run with grok-build channel aijws`: ACP session created and completed with pong

## Completion Summary

- 2026-07-18T13:44:30.207Z 已确认 aijws Key/模型有效；针对其偶发缺 id 导致的 Grok RPC -32603，在无运行副作用时自动重试一次并通过回归测试。
- 2026-07-18T13:14:38.258Z 第三方 Grok 渠道 API Key 现在可直接用于 ACP，不再要求官方 grok login；真实 aijws 渠道请求已返回 pong。

## Follow-ups

- 待补充。
