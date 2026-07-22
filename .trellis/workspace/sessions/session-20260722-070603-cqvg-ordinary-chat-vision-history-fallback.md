# Session Record: 普通聊天历史图片兼容文本模型

- Session: session-20260722-070603-cqvg
- Started: 2026-07-22T07:06:03.866Z
- Task: .trellis/tasks/ordinary-chat-vision-history-fallback.md

## Notes
- 2026-07-22T07:06:43.992Z 补充 DeepSeek/OpenAI 兼容错误识别：messages[n] unknown variant image_url, expected text；仍要求历史图片存在、当前轮无图片且尚未产生事件。

- 2026-07-22T07:06:03.869Z Session started.

## Verification

- 2026-07-22T07:08:17.552Z `真实 MiniMax 图片历史 -> DeepSeek deepseek-v4-flash 纯文本切换`: 通过：首次 image_url 反序列化拒绝触发兼容状态，移除历史图片后重试返回 OK；临时会话已删除。
- 2026-07-22T07:08:15.989Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；覆盖 OpenAI 兼容接口 unknown variant image_url, expected text 的历史图片降级识别。

## Completed

- 2026-07-22T07:08:39.339Z 补充 DeepSeek/OpenAI兼容接口对历史 image_url 消息块反序列化失败的识别；当前轮纯文本时自动移除历史图片重试，真实 DeepSeek V4 Flash 回归成功。
