# Task: Agent Mux 真实连接检查

## Background

待补充背景。

## Objective

复用 CodeM 现有 Provider 探测能力，将 Agent Mux 配置测试从模拟状态迁移为真实 Agent CLI 探测

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record
- 2026-08-04T17:08:33.156Z 已将 Agent Mux 配置测试切换为真实 Agent CLI 探测；运行配置新增 channelId，仅保存已有 Agent 渠道引用，不复制密钥。

- 2026-08-04T17:00:09.223Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T17:08:33.258Z `git diff --check`: 通过
- 2026-08-04T17:08:33.221Z `cargo check --manifest-path src-tauri/Cargo.toml`: 通过；仅有既有 dead_code 警告

- 2026-08-04T17:08:33.200Z `npm run build`: 通过；Vite 仅有既有 chunk 大小警告
- 2026-08-04T17:08:33.147Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-04T17:08:44.450Z Agent Mux 已完成 SQLite 配置持久化、安装版渠道引用选择和真实 Agent CLI 连接检查；MiniMax/DeepSeek 等渠道沿用现有 Agent 渠道库，未复制密钥。真实任务调用、实时运行监控和外部 Skill 服务仍列为后续工作。

## Follow-ups

- 待补充。
