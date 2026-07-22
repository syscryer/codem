# Task: 普通聊天错误详情持久化

## Background

普通聊天的 SSE `error` 事件已经包含上游真实错误，但运行结束后前端会重新读取 SQLite 历史。
当前 `ai_messages` 只保存 `status = error`，历史恢复只能生成通用“运行失败”，导致当前热会话刚收到的错误详情被覆盖。

## Objective

保留普通聊天上游错误详情，并在当前会话和历史恢复后统一展示

## Scope

In scope:

- 为普通聊天消息持久化错误详情，并兼容迁移现有 SQLite。
- 历史 API 返回错误详情，当前会话刷新和重新打开后保持一致。
- 对话卡片以现有主题 token 展示错误标题和可换行的详细原因。
- 补充 Rust 持久化测试和前端历史映射测试。
- 网络请求未获得 HTTP 响应时，展示 reqwest 底层错误链，并清理 URL 查询参数、用户信息和敏感字段。

Out of scope:

- 不修改 Agent 运行、历史和错误处理机制。
- 不修改普通聊天 SSE event contract。
- 不诊断或规避具体供应商错误，先确保原始错误可见。

## Impact

- Backend: `src-tauri/src/ordinary_chat/{storage,runtime,types}.rs`
- Frontend contract/state: `src/types.ts`, `src/hooks/useOrdinaryChat.ts`
- Conversation UI: `src/components/ConversationTurn.tsx`, `src/styles.css`
- Tests: ordinary chat storage and history mapping tests

## Acceptance Criteria

- [ ] 普通聊天失败后立即显示后端返回的具体错误。
- [ ] 运行结束后的历史刷新不会把具体错误覆盖为通用文案。
- [ ] 重开聊天后仍可看到相同错误详情。
- [ ] 现有数据库自动增加错误字段，不破坏旧消息。
- [ ] 成功消息不携带错误详情，长错误文本正常换行。
- [x] 网络层错误展示底层 connect/TLS/timeout/stream cause，不再只显示顶层 URL 摘要。
- [x] 原始错误详情不包含 URL 查询参数、用户名密码、API Key 或 Token。

## Verification Commands

- `npm run typecheck`
- `node --test --import tsx src/lib/ordinary-chat-reasoning.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::storage::tests`
- `git diff --check`

## Implementation Record

- 2026-07-22T06:42:04.402Z 普通聊天网络错误改为展示 reqwest 顶层摘要与完整 source cause chain；URL 查询参数、fragment、用户名密码先移除，再经过敏感字段扫描；错误详情上限由 500 调整为 2000 字符。
- 2026-07-19T05:55:32.889Z 已补充 ai_messages.error_message 兼容迁移、失败写入/成功清空、历史 API 字段与普通聊天错误详情卡片；SSE 协议和 Agent 运行链保持不变。

- 2026-07-19T05:47:02.885Z Task created by Trellis automation.

## Verification Results

- 2026-07-22T06:42:06.005Z `rustfmt --check provider.rs/runtime.rs；git diff --check`: 通过；仅 Git 的既有 LF/CRLF 提示。桌面开发后端已热更新到新进程。
- 2026-07-22T06:42:05.203Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider`: 通过：17/17；新增关闭端口网络错误测试确认底层 cause 可见，URL key 查询参数与密钥值不泄露。

- 2026-07-19T06:06:48.644Z `git diff --check`: 通过，无空白错误
- 2026-07-19T06:06:46.933Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::`: 通过，普通聊天 Rust 测试 44/44；仅有既有 dead_code/linker 警告

- 2026-07-19T06:06:45.746Z `node --test --import tsx src/lib/ordinary-chat-*.test.ts`: 通过，普通聊天前端定向测试 24/24
- 2026-07-19T06:06:44.021Z `npm run typecheck`: 通过，TypeScript 编译无错误

## Completion Summary

- 2026-07-22T06:42:17.610Z 普通聊天网络请求错误现会展示 reqwest 原始 cause chain，帮助区分连接、TLS、超时与流读取失败；HTTP 响应正文继续原样展示，所有 URL 查询参数和敏感字段保持脱敏。
- 2026-07-19T06:07:02.053Z 普通聊天上游错误详情已持久化到 ai_messages，实时失败、运行结束刷新与重开历史统一展示；兼容旧数据库并补齐迁移、失败保存/成功清空和前端恢复测试。

## Follow-ups

- 错误详情透传后，根据真实供应商响应另行判断 DeepSeek 请求参数兼容性。
