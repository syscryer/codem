# Session Record: 修复普通聊天模型 usage 空值崩溃

- Session: session-20260714-161057-hrtb
- Started: 2026-07-14T16:10:57.417Z
- Task: .trellis/tasks/ordinary-chat-usage-null.md

## Notes
- 2026-07-14T16:31:17.397Z 确认根因：OpenAI 兼容 SSE 的 usage:null 被 Rust 解析为 Some(Value::Null) 并下发，前端 normalizeAiUsageEvent 随后直接读取 input_tokens；已在普通聊天后端过滤非对象 usage，并在前端事件边界拒绝无效 usage。

- 2026-07-14T16:10:57.422Z Session started.

## Verification

- 2026-07-14T16:33:47.662Z `npx tsx --test src/lib/ordinary-chat-reasoning.test.ts`: 4 个测试通过，覆盖 null usage 和 OpenAI、Anthropic、Gemini token 字段别名。
- 2026-07-14T16:31:21.578Z `Invoke-RestMethod http://127.0.0.1:3001/api/health`: Rust backend 健康检查通过，Web 5173 与 backend 3001 已按最新代码启动。

- 2026-07-14T16:31:20.752Z `Playwright 浏览器实发 DeepSeek / deepseek-v4-flash`: Enter 发送成功，返回 USAGE_NULL_FIX_OK，状态已处理并显示 49 tokens；控制台 0 error / 0 warning。
- 2026-07-14T16:31:19.925Z `npm run typecheck && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: TypeScript 类型检查和 Rust 格式检查通过。

- 2026-07-14T16:31:19.115Z `npx tsx --test src/lib/ordinary-chat-reasoning.test.ts`: 3 个测试通过，null usage 被忽略且有效 token 字段正常归一化。
- 2026-07-14T16:31:18.232Z `cargo test --manifest-path src-tauri/Cargo.toml --lib ordinary_chat::provider::tests`: 13 个普通聊天 provider 测试全部通过，包含 usage:null 回归。

## Completed

- 2026-07-14T16:33:48.509Z 修复普通聊天 usage:null 崩溃：后端只下发对象型 usage，前端安全校验无效 usage；DeepSeek deepseek-v4-flash 浏览器实发与完整定向测试通过。
