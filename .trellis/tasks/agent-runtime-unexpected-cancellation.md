# Task: Agent 运行意外取消修复

## Background

OpenCode 的真实日志显示异常运行收到了 ACP `session/cancel`，用户没有发送空输入，也没有主动停止。后端 thread PATCH 当前只要请求体包含 `channelId`，就会关闭该 thread 的 Agent runtime；即使提交值与已保存值相同，也会误触发取消。

## Objective

修复等价渠道元数据更新误关闭正在运行的 Agent 热会话，并补充回归测试与真实 OpenCode 验收。

## Scope

In scope:

- 以持久化前后的真实渠道值判断 `channelId` 是否发生变化。
- 等价渠道 PATCH 不关闭 Agent runtime，不清理该 thread 的运行记录。
- 真实渠道变化继续关闭旧 runtime，避免不同渠道复用同一热会话。
- 为无关元数据、等价渠道和真实渠道变化补充回归测试。

Out of scope:

- 不把空输入逻辑当作本次异常原因；该交互是否调整另行处理。
- 不处理 ACP 固定 300 秒超时问题。
- 不修改 Provider 的登录、渠道配置或用户凭据。

## Impact

- Backend thread metadata update：`src-tauri/src/backend.rs`。
- Agent runtime 生命周期：仅收紧渠道切换时的关闭条件，不修改公开事件协议。
- SQLite schema、frontend contract 和历史格式均不变。

## Acceptance Criteria

- [x] PATCH 仅更新 session、工作目录、权限、模型或思考等级时，返回“渠道未变化”。
- [x] 当前渠道为 `null` 时再次 PATCH `{ "channelId": null }`，不关闭 runtime。
- [x] 渠道从具体值切换为系统默认时，仍识别为真实变化并关闭旧 runtime。
- [x] 相关 Rust 测试、typecheck 和 build 通过。
- [x] 桌面开发模式重启后，OpenCode 正常发送可完成。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml <targeted-test>`
- `npm run typecheck`
- `npm run build`
- 桌面开发模式下真实 OpenCode 发送与等价渠道 PATCH 复测。

## Implementation Record
- 2026-08-11T04:19:53.095Z 已确认用户未执行空输入；修复 thread PATCH 仅在渠道值真实变化时关闭 Agent runtime，并补充等价渠道与真实切换回归断言。

- 2026-08-11T04:14:31.056Z Task created by Trellis automation.

## Verification Results

- 2026-08-11T04:36:14.237Z `桌面重启与真实 OpenCode 等价渠道 PATCH 复测`: 动态 Rust backend 健康；运行中同值 channelId PATCH 未取消；普通发送 HTTP 200 并返回 OPENCODE_AFTER_FIX_OK
- 2026-08-11T04:36:13.477Z `codem-agent-onboarding check_onboarding.py`: 72 contract tests、typecheck、Rust format/runtime/automation tests、build 全部通过

- 2026-08-11T04:36:12.849Z `cargo test --manifest-path src-tauri/Cargo.toml`: 477 passed, 1 ignored
- 2026-08-11T04:36:12.236Z `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_persists_official_thread_id_without_claude_transcript_path`: 1 passed

- `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_persists_official_thread_id_without_claude_transcript_path`：1 passed。
- `cargo test --manifest-path src-tauri/Cargo.toml`：477 passed，1 ignored。
- CodeM Agent onboarding gate：72 条前端合同测试、typecheck、Rust format、Agent runtime/automation 测试和 production build 全部通过。
- 桌面开发模式已重启：`codem.exe` 与动态 Agent Mux 均正常运行，runtime identity 为 Rust backend。
- 真实 OpenCode 竞态复测：运行中 PATCH 当前 `channelId` 后，OpenCode 完成 shell 等待与后续回复，runtime 回到 `ready`，日志未出现 `session/cancel`。
- 真实 OpenCode 普通发送：HTTP 200，返回验收标记 `OPENCODE_AFTER_FIX_OK`。

## Completion Summary
- 2026-08-11T04:36:29.969Z 修复 thread PATCH 对 channelId 的存在性误判：仅真实渠道变化才关闭 Agent runtime；补充回归断言，完成完整测试、接入门禁、桌面重启与真实 OpenCode 竞态验收。

thread metadata helper 现在返回真实 `channel_changed`，`update_thread` 仅在渠道持久化值实际变化时关闭 Agent runtime。重复提交当前渠道或只写回 session 等元数据不会再误取消正在运行的 ACP 会话；真实渠道切换仍保持原有清理语义。

## Follow-ups

- 后续可把用户停止、渠道变化、thread/project 删除等取消来源纳入统一结构化运行诊断；本次先修复已确认的错误取消入口，不用 UI 文案掩盖原因。
