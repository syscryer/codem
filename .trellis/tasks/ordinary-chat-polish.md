# Task: 普通聊天 MCP 弹层与 DeepSeek 思考适配

## Background

普通聊天能力开关上线后，MCP 弹层仍使用硬编码颜色和原生滚动行为，长命令路径会产生横向溢出；DeepSeek V4 已支持思考，但未被普通聊天能力目录识别。

## Objective

统一 MCP 弹层全局 token 样式并支持 DeepSeek V4 Anthropic 思考等级

## Scope

In scope:

- 统一普通聊天菜单文字、悬浮、边框和滚动条 token。
- 限制 MCP 弹层尺寸并让命令/路径可换行。
- 支持 DeepSeek V4 在 Anthropic 兼容接口中的思考开关和等级参数。

Out of scope:

- 不新增 DeepSeek 联网搜索能力。
- 不调整 Agent 的 Skills/MCP 运行机制。

## Impact

- Frontend: `src/styles.css`、普通聊天 Composer 菜单。
- Backend: `src-tauri/src/ordinary_chat/provider.rs` 的模型能力和请求映射。

## Acceptance Criteria

- [x] MCP 弹层使用全局 token，长路径不产生横向滚动。
- [x] DeepSeek V4 Flash/Pro 显示思考控制并发送官方兼容参数。
- [x] 联网搜索仍按当前能力目录保持禁用。

## Verification Commands

- 目前未接入 DeepSeek 原生联网搜索；如官方接口后续提供明确工具协议，再单独评估。

## Implementation Record
- 2026-07-19T05:17:48.202Z 统一普通聊天菜单 token：使用主题文字、悬浮和滚动条变量，MCP 弹层限制宽度并支持长命令路径换行；补充 DeepSeek V4 思考能力识别与 Anthropic thinking/output_config.effort 请求映射。

- 2026-07-19T05:17:29.982Z Task created by Trellis automation.

## Verification Results

- 2026-07-19T05:17:51.409Z `git diff --check`: 通过，无空白错误
- 2026-07-19T05:17:50.853Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::provider::tests::runtime_options_map_to_protocol_native_fields --no-fail-fast`: DeepSeek/协议 runtime options 定向测试通过

- 2026-07-19T05:17:50.001Z `node --test --import tsx src/lib/ordinary-chat-capabilities.test.ts src/lib/ordinary-chat-settings.test.ts`: 19 个测试全部通过
- 2026-07-19T05:17:49.084Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-19T05:17:51.980Z MCP 弹层已统一全局 token 并修复长路径横向溢出；DeepSeek V4 Flash/Pro 已支持思考开关和等级映射，联网搜索仍按能力保持禁用。

## Follow-ups

- 待补充。
