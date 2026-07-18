# Session Record: 修复 Grok Todo 结构化事件误显示

- Session: session-20260718-023946-lf1y
- Started: 2026-07-18T02:39:46.882Z
- Task: .trellis/tasks/grok-todos-rendering.md

## Notes

- 2026-07-18T02:44:11.242Z 已重启桌面开发版，Rust 后端重新编译并监听 127.0.0.1:3001；未发起真实 Grok 外部请求，使用等价 ACP payload 完成回归验证。
- 2026-07-18T02:42:56.027Z 确认根因：Grok ACP 将 TodosUpdated 结构化 Todo 状态作为 agent_message_chunk 文本返回；在 ACP 归一化层按完整 JSON、state.todos 和 type=Todo 严格过滤，普通 JSON 保留。

- 2026-07-18T02:39:46.886Z Session started.

## Verification

- 2026-07-18T02:42:55.988Z `npm run typecheck && npm run build && git diff --check`: 通过；Vite 构建完成，仅有既有分包大小提示
- 2026-07-18T02:42:55.954Z `cargo test --manifest-path src-tauri/Cargo.toml acp`: 16 passed, 1 ignored（真实 Grok 凭据测试）

## Completed

- 2026-07-18T02:44:20.443Z 修复 Grok ACP 的 TodosUpdated 结构化消息被当作普通回答展示的问题；仅过滤严格匹配的 Todo JSON，保留正常 JSON、Thinking、工具事件和 Todo 卡片。ACP、类型检查、构建和 diff 校验均通过，桌面开发版已重启。
