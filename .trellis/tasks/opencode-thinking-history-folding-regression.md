# Task: 修复 OpenCode 思考历史折叠回归

## Background

OpenCode ACP 实时事件已经能够把公开思考映射为 Thinking timeline item，部分模型正文中的
`<think>` / `<thinking>` 也会转换为同一折叠组件。用户刷新或重新进入会话后，截图中的英文思考
却与最终回答一起显示为普通正文，说明实时 timeline 与持久化历史恢复结果不一致。

## Objective

定位并修复 OpenCode 公开思考在刷新或历史恢复后被压成普通正文的问题，确保实时与持久化 timeline 一致

## Scope

In scope:

- 核对当前 SQLite 历史、历史 API payload 和前端修复后的 item 类型。
- 修复导致 Thinking item 在历史路径丢失或降级为 text item 的真实数据流。
- 保持 DCP 内部消息标识继续隐藏。
- 补充刷新/历史恢复路径回归测试。

Out of scope:

- 不修改 OpenCode 或 MiniMax 的思考生成方式。
- 不从无协议标识的普通正文中猜测思考边界。
- 不修改 Claude Code 等其他 Agent 的既有 Thinking 语义。

## Impact

- 会话历史持久化与恢复路径。
- 前端 conversation timeline 归一化。

## Acceptance Criteria

- [x] 实时 OpenCode thought chunk 显示为可折叠 Thinking item。
- [x] 刷新或重新进入后仍保持同样的 Thinking/Text item 边界。
- [x] 完成态 Thinking 默认折叠并可展开。
- [x] DCP message id 不出现在正文、历史或复制内容中。
- [x] 定向测试、类型检查和相关后端测试通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml thread_history_round_trip_preserves_thinking_items --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_database_adds_item_type_to_existing_messages_table --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record

- 2026-07-16T13:50:02.168Z 修复：为 messages 新增 item_type 自动迁移，按 text/thinking/system-command 写入和恢复；thinking 不再拼入 assistantText。当前两条测试历史已依据 OpenCode export 的完整 think 标签精确修复。
- 2026-07-16T13:50:01.248Z 根因确认：messages 仅保存 role，thinking/text 都以 assistant 写入，历史读取统一恢复为 text 并拼入 assistantText；DCP 过滤本身未修改 Thinking 组件。

- 2026-07-16T13:34:44.606Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T13:50:08.266Z `Playwright http://127.0.0.1:5173`: 两条历史均显示默认折叠的 Thinking 组，正文仅保留最终中文回答，DCP 标识不可见，控制台无警告或错误。

- 2026-07-16T13:50:07.316Z `真实 SQLite API round-trip`: 临时 OpenCode 线程写入 thinking,text 后读取仍为 thinking,text，assistantText 仅包含最终回答；临时线程已删除并恢复原选择。
- 2026-07-16T13:50:06.413Z `git diff --check`: 通过；仅有工作区既有 LF/CRLF 提示，无空白错误。

- 2026-07-16T13:50:05.612Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: Rust 格式检查通过。
- 2026-07-16T13:50:04.765Z `npm run typecheck`: TypeScript 类型检查通过。

- 2026-07-16T13:50:03.927Z `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`: 19/19 通过，Thinking、DCP、历史归一化行为正常。
- 2026-07-16T13:50:03.037Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 143 项通过，1 项真实 Grok 登录 smoke test按设计忽略。

## Completion Summary
- 2026-07-16T13:50:21.038Z 修复 OpenCode Thinking 历史折叠回归：SQLite 现持久化 timeline item_type，刷新后保持 thinking/text 边界，Thinking 不再混入 assistantText；当前测试会话已按 OpenCode 源数据修复并通过浏览器验证。

## Follow-ups

- 无。
