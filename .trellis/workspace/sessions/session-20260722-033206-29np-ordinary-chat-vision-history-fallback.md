# Session Record: 普通聊天历史图片兼容文本模型

- Session: session-20260722-033206-29np
- Started: 2026-07-22T03:32:06.704Z
- Task: .trellis/tasks/ordinary-chat-vision-history-fallback.md

## Notes
- 2026-07-22T03:35:37.906Z 已确认失败根因：普通聊天切换文本模型后仍发送历史图片。实现仅在上游明确拒绝视觉、当前轮无图片且尚未产生流式事件时，移除内存历史图片并重试一次；持久化历史和当前轮图片保持不变。

- 2026-07-22T03:32:06.711Z Session started.

## Verification
- 2026-07-22T03:39:40.336Z `真实 MiniMax 图片历史 -> Silicon DeepSeek-V4-Flash 纯文本切换`: 通过：图片轮返回 OK；文本轮检测到不支持视觉后发出兼容状态、移除历史图片重试并返回 OK；临时会话已删除。

- 2026-07-22T03:39:39.542Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests::maps_image_blocks_to_each_provider_protocol；npm run typecheck；rustfmt --check；git diff --check`: 通过：四协议图片映射 1/1、TypeScript、Rust 格式和差异检查均通过；仅仓库既有 dead_code/linker warnings。
- 2026-07-22T03:39:38.723Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；覆盖历史图片视觉拒绝重试、当前图片保护、非视觉错误和已产生事件不重试。

## Completed

- 2026-07-22T03:39:50.813Z 修复普通聊天切换文本模型后被历史图片阻断：仅在上游明确拒绝视觉且当前轮无图片、尚未输出时，移除本次运行内存中的历史图片重试一次；当前图片、持久化历史、非视觉错误和 Agent 链路保持不变。定向测试与真实 Silicon 回归通过。
