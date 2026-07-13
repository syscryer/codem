# Task: 实验 Agent 运行设置开关

## Background

Grok Build 与 OpenAI Codex 的运行链路已实现，但仅能通过启动前设置环境变量开启，用户无法在 CodeM 设置页查看或调整状态。

## Objective

通过持久化设置控制 Grok Build 与 OpenAI Codex 的实验运行开放状态，移除用户对启动环境变量的依赖。

## Scope

In scope:

- 在 Agent 与模型的提供商页增加实验性 Agent 运行开关。
- 将开关持久化到本机 settings.json，并在后端运行时即时生效。
- 让 Provider Registry、创建聊天和 Agent Run API 使用同一开关状态。
- 移除前端和接口中要求用户设置环境变量的提示。

Out of scope:

- 不改变 Claude Code 的运行路径。
- 不将 CodeM Agent 从 planned 状态改为可用。
- 不中断已经运行中的 Grok 或 Codex 任务。

## Impact

- frontend：Provider 设置页、设置类型与设置 API。
- backend：settings.json 规范化、运行时状态、Provider Registry、Agent Run 与新聊天校验。
- persistence：在既有 settings.json 增加 agentRuntime.experimentalAgentRunEnabled，旧设置默认关闭。

## Acceptance Criteria

- [x] 开关默认关闭，开启状态跨重启保留。
- [x] 开关立即刷新 Provider Registry；Grok 和 Codex 仅在开启且对应 CLI 可用时可选择。
- [x] 关闭开关后，新的 Grok/Codex 聊天和运行请求被拒绝，Claude Code 不受影响。
- [x] 已运行的 Agent 任务不会因关闭开关被中断。
- [x] 不再要求用户设置 CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- 设置 API 与 Provider Registry 的真实开关探针

## Implementation Record

- 2026-07-13T02:43:04.884Z 已新增 Provider 设置页实验开关、agentRuntime 持久化设置和共享原子运行状态；Provider Registry、新建聊天与 Agent Run API 共用该状态，环境变量门禁和提示已移除。
- 2026-07-13T02:16:24.959Z 确认以 settings.json 的 agentRuntime.experimentalAgentRunEnabled 作为唯一真相源；开关更新后同步刷新共享运行状态，后续 Grok/Codex 新会话立即生效，运行中任务不被中断。

- 2026-07-13T02:14:35.861Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T02:43:52.747Z `npm run typecheck`: 通过：TypeScript project references 无错误。

- 2026-07-13T02:43:23.352Z `真实桌面 3001 设置与 UI 探针`: 通过：UI 开关关闭时 Grok/Codex 变 planned，开启后 Codex active/selectable；关闭时完整 Agent Run 请求返回 403；settings.json 持久化后恢复开启。
- 2026-07-13T02:43:23.334Z `cargo test --manifest-path src-tauri\\Cargo.toml`: 通过：41 passed，1 个需要真实 Grok 登录的 smoke 按设计 ignored。

## Completion Summary
- 2026-07-13T02:45:06.979Z 完成实验 Agent 运行持久化设置开关：Provider 页面可即时启用/关闭 Grok 与 Codex，状态写入 settings.json，Registry、建聊和运行 API 同步受控；前端、Rust 与真实桌面验证均通过。

## Follow-ups

- 历史任务记录保留其当时使用环境变量的验证命令，不能作为当前用户操作说明。
