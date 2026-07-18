# Task: Grok 渠道共享底层会话

## Background

Grok ACP 的 session 文件位于 `GROK_HOME` 下。此前 CodeM 按渠道创建目录，切换供应商并重启 runtime 后，新的渠道目录无法加载旧 session，导致同一个 CodeM 会话失忆。

## Objective

同一个 CodeM 线程切换 Grok 供应商时，在发送阶段重启 runtime 但继续使用同一个底层 ACP session；线程之间保持运行目录隔离，并保留现有同渠道热会话行为。

## Scope

In scope:

- 同一 CodeM 线程的 Grok runtime 使用线程级共享目录。
- 发送阶段渠道变化才重启 runtime，并继续传递原 `sessionId`。
- 兼容已有按渠道目录保存的 session，首次使用时迁移对应工作区。
- 不同 CodeM 线程保持目录隔离。

Out of scope:

- 不跨不同 Agent Provider 复用 session。
- 不覆盖用户全局 `~/.grok` 配置。

## Impact

- `src-tauri/src/agent_channels.rs`：线程级 Grok 目录、旧 session 迁移。
- `src-tauri/src/agent_run.rs`：按线程和 session 解析渠道 runtime。
- `src-tauri/src/backend.rs`：兼容 Claude 渠道 runtime 调用签名。
- `src/hooks/useAgentRun.ts`、`src/lib/agent-channel-selection.ts`：Grok 渠道变化继续复用 session。

## Acceptance Criteria

- [x] 同一线程切换 Grok 供应商后，发送时重启 runtime 并复用原 session ID。
- [x] 新渠道能读取原 session 上下文，而不是新建空会话。
- [x] 不同线程使用不同 Grok 运行目录。
- [x] 已有按渠道目录的 session 可以迁移到线程目录。
- [x] 同渠道热会话、Claude/Codex 及普通聊天行为不变。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `npm run typecheck`
- `npx tsx --test src/lib/agent-channel-selection.test.ts`
- `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`
- `git diff --check`
- 桌面开发版真实 Grok A→B 渠道切换验证

## Implementation Record
- 2026-07-18T12:04:27.213Z 桌面开发版真实验证通过：同一临时线程先用 Grok 渠道 A 创建 session 019f7518-7c61-7672-9cb4-689e05b570f5，再切换渠道 B 重启 runtime；返回相同 sessionId 并显示已恢复，续问正确回答上一轮内容。旧按渠道目录 session 迁移单测通过。

- 2026-07-18T11:51:23.143Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T12:04:25.245Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs && git diff --check`: pass

- 2026-07-18T12:04:23.800Z `npx tsx --test src/lib/agent-channel-selection.test.ts`: pass: 10 passed, 0 failed
- 2026-07-18T12:04:21.540Z `npm run typecheck`: pass

- 2026-07-18T12:04:20.397Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: pass: 28 passed, 0 failed
- 2026-07-18T12:04:19.586Z `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`: pass: 8 passed, 0 failed

## Completion Summary
- 2026-07-18T12:04:29.005Z Grok 现在按 CodeM 线程共享运行目录；同一线程切换供应商时发送阶段重启 runtime 并恢复原 ACP session，不同线程保持隔离；已有旧渠道 session 支持迁移。前端、Rust 定向测试、类型/格式/diff 检查及桌面版真实 A→B 验证通过。

## Follow-ups

- 如 Grok ACP 后续提供标准 session fork/import，可再评估是否移除旧目录迁移逻辑。
