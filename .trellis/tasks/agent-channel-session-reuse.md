# Task: Agent 渠道切换保持会话

## Background

当前线程已经绑定一个 Agent Provider，但同一 Provider 下的渠道切换会在前端清空线程 `sessionId`。发送下一条消息时，后端因此只能创建新底层会话，导致 Codex/Claude Code 无法像 ccswitch 一样在重启进程后继续原上下文。

## Objective

同一个 Agent 内切换渠道时，在发送消息阶段重启运行实例并保留可恢复的 sessionId，不影响现有同渠道热会话复用，也不允许跨 Agent 类型切换。

## Scope

In scope:

- 同一个 Agent Provider 内切换渠道后，在发送阶段重启不兼容的热运行时。
- 保留线程 `sessionId`，让 Claude Code/Codex 使用原 session 恢复。
- 保持同渠道、同配置下的现有热运行时复用。
- 覆盖渠道切换选择逻辑和前端 session 传递回归测试。

Out of scope:

- 不允许同一线程跨 Agent Provider 切换。
- 不新增 session 持久化表或改变历史数据结构。
- 不在用户仅切换下拉选项时提前启动/重启 Agent。

## Impact

- 前端：`useClaudeRun`、`useAgentRun`、渠道选择 helper。
- 后端：复用现有 runtime fingerprint/config 比较和 session resume 能力，不改变事件协议。
- 持久化：渠道元数据更新不再覆盖已确认的线程 `sessionId`。

## Acceptance Criteria

- [x] 同一 Provider 渠道变化后，发送请求仍携带原线程 `sessionId`。
- [x] 后端因渠道配置指纹变化重启运行时，并尝试恢复该 session。
- [x] 同渠道发送仍复用现有热运行时。
- [x] 渠道选择失败或无效回落时不清空有效 `sessionId`。
- [x] 前端类型检查与渠道选择测试通过。

## Verification Commands

- `npx tsx --test src/lib/agent-channel-selection.test.ts src/lib/queued-prompts.test.ts src/lib/grok-permission-modes.test.ts`
- `npm run typecheck`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`
- `git diff --check`

## Implementation Record
- 2026-07-18T09:16:35.163Z 实现同一 Agent 内渠道切换的发送时 session 保留：Claude Code/Codex 渠道变化不再清空线程 sessionId；后端按现有 runtime 配置指纹在发送时重启实例并恢复 session；ACP 不支持 loadSession 时回落新建底层会话，避免破坏原有渠道。

- 2026-07-18T09:07:23.538Z Task created by Trellis automation.

## Verification Results

- 2026-07-18T09:16:43.094Z `npm run typecheck; cargo check; cargo test; rustfmt agent_run; git diff check`: typecheck、cargo check、Rust 全量测试 160 passed/1 ignored、agent_run.rs rustfmt 和 diff 检查通过；全仓 cargo fmt 的既有其他文件格式差异未修改
- 2026-07-18T09:16:35.166Z `npx tsx --test src/lib/agent-channel-selection.test.ts src/lib/queued-prompts.test.ts src/lib/grok-permission-modes.test.ts`: 33 passed, 0 failed

## Completion Summary
- 2026-07-18T09:17:15.843Z 完成同一 Agent 内渠道切换的发送时 session 保留。渠道选择不再清空 Claude Code/Codex 线程 session；发送时由现有 runtime 配置比较触发重启并恢复 session；ACP 不支持 loadSession 时回落新建会话，保持原有渠道可用。定向前端测试 33 项、typecheck、cargo check、Rust 全量测试 160 项通过。

## Follow-ups

- 真实接入各 Agent CLI 做一次渠道 A/B 切换手工验收，确认供应商是否接受恢复的 session 内容。
