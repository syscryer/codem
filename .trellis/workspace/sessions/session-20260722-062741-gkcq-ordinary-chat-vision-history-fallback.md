# Session Record: 普通聊天历史图片兼容文本模型

- Session: session-20260722-062741-gkcq
- Started: 2026-07-22T06:27:41.555Z
- Task: .trellis/tasks/ordinary-chat-vision-history-fallback.md

## Notes
- 2026-07-22T06:28:15.806Z 补充 OpenRouter 视觉拒绝文案：No endpoints found that support image input；继续复用仅历史图片、当前轮无图片且尚未输出时的单次重试边界。

- 2026-07-22T06:27:41.563Z Session started.

## Verification

- 2026-07-22T06:32:38.049Z `真实 MiniMax 图片历史 -> OpenRouter Nemotron 纯文本切换`: 历史图片 404 已触发兼容状态并进入无历史图片重试；重试请求不再报视觉错误，最终由上游返回 502 ResourceExhausted，真实错误按设计透传；临时会话已删除。
- 2026-07-22T06:32:37.288Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；新增 OpenRouter No endpoints found that support image input 错误模式回归断言通过。

## Completed

- 2026-07-22T06:32:51.277Z 补充 OpenRouter 无图片端点 404 的视觉拒绝识别；真实回归确认历史图片会被降级并进入纯文本重试，后续 NVIDIA 502 容量错误保持真实透传。
