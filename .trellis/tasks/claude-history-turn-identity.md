# Task: 修复 Claude 会话历史重复

## Background

Claude Code transcript 会在一次会话中反复写入 `last-prompt` 元数据。CodeM 虽然不会把该元数据直接解析成用户消息，但 transcript 每次重解析都会为同一 turn 生成新的随机 ID；前端历史刷新按 ID 合并时，会把旧的完成 turn 和新解析 turn 同时保留，造成聊天内容重复。

## Objective

稳定 Claude transcript turn 身份并清理前端历史合并产生的重复消息

## Scope

In scope:

- Claude transcript 首次解析生成稳定 turn ID。
- transcript 重解析时继承已持久化的 CodeM turn ID。
- 相同用户提示词多次发送时按出现顺序分别匹配，不合并为一轮。
- 覆盖真实 `last-prompt` 元数据格式和连续历史读取回归测试。

Out of scope:

- 不清理或改写 Claude Code 原始 JSONL。
- 不按文案删除 SQLite 历史，不修改历史表结构。
- 不调整非 Claude Provider 的历史合并策略。

## Impact

- Backend: `src-tauri/src/backend.rs` Claude transcript 解析与存储历史合并。
- Frontend contract 不变；桌面重启后重新加载唯一历史 turn。

## Acceptance Criteria

- [x] 同一 transcript 连续解析返回相同 turn ID。
- [x] 已持久化 turn 在 transcript 重解析后继续保留原 CodeM ID。
- [x] 两次相同用户提示词仍保留两个不同 turn 和不同 ID。
- [x] `last-prompt` 元数据不生成额外用户 turn。
- [x] Rust 回归测试、Agent onboarding 门禁、typecheck 和 build 通过。
- [x] 桌面开发模式重启后，真实 CC 会话历史不再重复累积。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml claude_transcript_turn_ids_stay_stable_across_reparse --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml reparsed_claude_history_preserves_stored_turn_ids_for_repeated_prompts --lib`
- `python C:\Users\syscr\.codex\skills\codem-agent-onboarding\scripts\check_onboarding.py D:\ai_proj\codem`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-11T07:43:56.887Z 确认真实 Claude transcript 只有一条 user 消息；重复源于每次历史重解析生成随机 turn ID。实现 CC 原生稳定 ID，并在重解析时按 session 与同文案出现顺序继承已存储 CodeM turn ID。

- 2026-08-11T07:36:17.664Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T07:50:52.746Z `桌面重启后真实 CC history 连续读取`: 两次均返回 5 个 turn，5 个 ID 全部稳定且唯一；目标 delete 提示词仅 1 次

- 2026-08-11T07:50:52.095Z `codem-agent-onboarding check_onboarding.py；npm run build；git diff --check`: 72 条合同测试、typecheck、Rust format/runtime/automation、生产构建和差异检查全部通过
- 2026-08-11T07:50:51.449Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 479 passed, 1 ignored；稳定 turn ID 与重复提示词回归测试均通过

## Completion Summary
- 2026-08-11T07:50:53.456Z 修复 Claude transcript 重解析随机 turn ID 导致的聊天内容重复：首次解析使用 CC 原生稳定标识，重解析继承 CodeM 已存储 ID，并按同文案出现顺序区分真实重复发送；完成自动化门禁、桌面重启和真实会话验收。

## Follow-ups

- 无。
