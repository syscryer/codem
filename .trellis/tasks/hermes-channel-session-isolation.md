# Task: 修复 Hermes 切换渠道后恢复旧会话

## Background

Hermes session 会保存创建时的模型 Provider。此前为了避免新渠道 Runtime 无法识别旧 Provider，将 Hermes 错误地改成了“渠道绑定 session”，导致切换渠道后丢失原生会话上下文。Hermes Desktop 的正确机制是恢复同一个持久 session，再通过 `config.set` 切换该 session 当前使用的模型与 Provider。

## Objective

Hermes 渠道变化时保留持久 sessionId，在统一受管 Provider 配置上恢复原会话，并原生切换模型与 Provider；其他 Agent 行为保持不变。

## Scope

In scope:

- Hermes 渠道变化时，前端运行请求继续复用持久 sessionId。
- 后端元数据更新仅清理渠道指纹，不清理 Hermes sessionId。
- Hermes 受管配置同时注册所有已启用的 Hermes 渠道，凭据只通过环境变量注入。
- Hermes 恢复或创建 session 后，通过 `config.set` 设置目标模型与 Provider。
- 回归验证 Codex 仍按渠道绑定 session，Claude/Grok 等仍保留原有行为。

Out of scope:

- 不通过捕获 `Unknown provider` 后静默重试掩盖问题。
- 不把 CodeM 历史消息重新拼接进 prompt 伪造 Hermes 记忆。
- 不修改聊天框自适应布局。

## Impact

- `src/lib/agent-channel-selection.ts` 与定向测试。
- `src-tauri/src/backend.rs` 的线程元数据持久化与 Rust 回归测试。
- `src-tauri/src/agent_channels.rs` 的 Hermes 统一受管配置。
- `src-tauri/src/hermes.rs` 的原生 session 配置切换。

## Acceptance Criteria

- [ ] Hermes 从 MiniMax 切换到 DeepSeek 时继续携带原持久 sessionId。
- [ ] Hermes 渠道元数据更新清理模型、思考级别和渠道指纹，但保留 sessionId。
- [ ] 统一受管配置包含所有已启用 Hermes Provider，且不落盘 API Key。
- [ ] `config.set(model)` 在恢复 session 后、提交 prompt 前使用目标 Provider。
- [ ] Codex 仍在渠道变化时清理 session，Claude/Grok 行为不变。
- [ ] 定向前端/Rust 测试、typecheck、onboarding gate 和 diff check 通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml hermes_channel_switch_preserves_persistent_session`
- `npm run typecheck`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `git diff --check`

## Implementation Record

- 2026-08-10T16:01:39.379Z 修正 Hermes 渠道切换语义：仅 Codex 保持渠道绑定 session；Hermes 保留持久 sessionId，统一受管配置注册全部启用渠道并通过环境变量注入凭据，恢复后使用原生 config.set 切换模型与 Provider。其他 Agent 路径不变。
- 2026-08-10T15:16:08.070Z session-20260810-145456-3wdu 完成 Hermes 渠道切换会话隔离：Hermes 与 Codex 统一按渠道绑定 session；切换时清理 sessionId 与渠道指纹；并修复当前 e196316f 线程的旧 MiniMax sessionId。验证：23 项前端定向测试、Rust Hermes 回归测试、npm run typecheck、git diff --check 通过；Agent Mux 动态端口 52043 的 /api/runtime/identity 返回 CodeM Rust。

- 2026-08-10T14:54:56.416Z Task created by Trellis automation.
- 2026-08-10T14:54:56+08:00 对照 Hermes 官方源码确认 `HERMES_MANAGED_DIR` 是受管配置覆盖层，根因不是 Provider 配置注入，而是跨渠道复用了固化旧 Provider 的 session。

## Verification Results
- 2026-08-10T16:01:55.704Z `Hermes real CLI MiniMax-to-DeepSeek session resume`: pass: session 20260810_235826_273371 retained ORCHID-7319; temporary thread deleted

- 2026-08-10T16:01:55.077Z `git diff --check`: pass
- 2026-08-10T16:01:54.381Z `codem-agent-onboarding gate`: pass: 72/72 plus Rust runtime/automation/build gates

- 2026-08-10T16:01:53.724Z `npm run typecheck`: pass
- 2026-08-10T16:01:53.038Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass: 475 passed, 1 ignored

- 2026-08-10T16:01:52.365Z `node --import tsx --test src/lib/agent-channel-selection.test.ts`: pass: 23/23; Hermes preserves session, Codex remains channel-bound
- 2026-08-10T15:19:48.352Z `node --import tsx --test src/lib/agent-channel-selection.test.ts; cargo test hermes_channel_switch_clears_channel_bound_session; onboarding gate; npm run typecheck; cargo fmt --check; npm run build; git diff --check`: 通过：前端 23/23，Rust 回归 1/1，onboarding 72/72，Runtime 14/14，automation 5/5，构建和静态检查通过；Agent Mux 52043 identity 正常；e196316f sessionId 已清空。

## Completion Summary
- 2026-08-10T16:02:08.106Z Hermes 跨渠道切换现在保留持久 session，通过统一受管 Provider 配置与原生 config.set 切换模型/Provider；Codex 及其他 Agent 行为保持不变。自动门禁和 MiniMax 到 DeepSeek 真实口令记忆测试均通过，桌面端已重启。

- 2026-08-10T15:20:18.012Z Hermes 跨渠道切换不再复用旧 Provider session；当前截图对应线程已完成数据修复并通过完整自动化验收。
- 2026-08-10T15:17:34.302Z session-20260810-145456-3wdu Hermes 跨渠道切换不再复用旧 Provider session；当前截图对应线程已完成数据修复，可直接验收。

## Follow-ups

- 待补充。
