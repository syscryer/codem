# Task: 修复普通聊天模型 usage 空值崩溃

## Background

普通聊天选择 `deepseek-v4-flash` 后发送消息，运行会显示已停止并弹出
`Cannot read properties of null (reading 'input_tokens')`。该模型通过 OpenAI 兼容流返回
`usage: null`，需要确保普通聊天链路不会把 JSON null 当作有效 usage 对象。

## Objective

定位并修复 deepseek-v4-flash 普通聊天流式响应中 usage 空值导致的失败，补充测试并完成浏览器实发回归

## Scope

In scope:

- 修正普通聊天供应商流对空 usage 的解析和事件下发。
- 在普通聊天前端事件边界拒绝非对象 usage，避免无效事件污染会话状态。
- 补充 Rust 流解析和 TypeScript usage 归一化回归测试。
- 重启 Web/backend，并用浏览器对 `deepseek-v4-flash` 实发验证。

Out of scope:

- 不调整 Agent 的事件流、模型配置或 usage 统计逻辑。
- 不改供应商设置页面和模型选择交互。

## Impact

- `src-tauri/src/ordinary_chat/provider.rs`
- `src/hooks/useOrdinaryChat.ts`
- 普通聊天定向测试与事件契约。

## Acceptance Criteria

- [x] OpenAI 兼容流中的 `usage: null` 不再产生普通聊天 usage 事件。
- [x] 前端收到 null 或非对象 usage 时不崩溃、不写入伪造 token 数据。
- [x] 有效 OpenAI/Anthropic/Gemini usage 对象仍能正常归一化。
- [x] `deepseek-v4-flash` 浏览器实发能够正常完成并显示回答。
- [x] Agent 相关代码和行为不受影响。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests::parses_tool_calls_from_all_streaming_protocols`
- `npx tsx --test src/lib/ordinary-chat-reasoning.test.ts`
- `npm run typecheck`
- 浏览器在普通聊天选择 `deepseek-v4-flash` 实际发送消息。

## Implementation Record
- 2026-07-14T16:31:17.397Z 确认根因：OpenAI 兼容 SSE 的 usage:null 被 Rust 解析为 Some(Value::Null) 并下发，前端 normalizeAiUsageEvent 随后直接读取 input_tokens；已在普通聊天后端过滤非对象 usage，并在前端事件边界拒绝无效 usage。

- 2026-07-14T16:10:57.420Z Task created by Trellis automation.

## Verification Results

- 2026-07-14T16:33:47.662Z `npx tsx --test src/lib/ordinary-chat-reasoning.test.ts`: 4 个测试通过，覆盖 null usage 和 OpenAI、Anthropic、Gemini token 字段别名。
- 2026-07-14T16:31:21.578Z `Invoke-RestMethod http://127.0.0.1:3001/api/health`: Rust backend 健康检查通过，Web 5173 与 backend 3001 已按最新代码启动。

- 2026-07-14T16:31:20.752Z `Playwright 浏览器实发 DeepSeek / deepseek-v4-flash`: Enter 发送成功，返回 USAGE_NULL_FIX_OK，状态已处理并显示 49 tokens；控制台 0 error / 0 warning。
- 2026-07-14T16:31:19.925Z `npm run typecheck && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: TypeScript 类型检查和 Rust 格式检查通过。

- 2026-07-14T16:31:19.115Z `npx tsx --test src/lib/ordinary-chat-reasoning.test.ts`: 3 个测试通过，null usage 被忽略且有效 token 字段正常归一化。
- 2026-07-14T16:31:18.232Z `cargo test --manifest-path src-tauri/Cargo.toml --lib ordinary_chat::provider::tests`: 13 个普通聊天 provider 测试全部通过，包含 usage:null 回归。

## Completion Summary
- 2026-07-14T16:33:48.509Z 修复普通聊天 usage:null 崩溃：后端只下发对象型 usage，前端安全校验无效 usage；DeepSeek deepseek-v4-flash 浏览器实发与完整定向测试通过。

## Follow-ups

- 无。
