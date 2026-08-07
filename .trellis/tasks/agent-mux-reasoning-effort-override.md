# Task: Agent Mux 外部思考等级覆盖

## Background

待补充背景。

## Objective

允许 invoke 通过 --reasoning-effort 显式覆盖 Profile 的 reasoningEffort，并验证 max 可透传

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
- 2026-08-07T06:40:04.362Z 调研 Provider 差异：Claude Code 走 /api/claude/run 的 effort，支持 low/medium/high/xhigh/max 与 CodeM ultracode；Codex 走 reasoningEffort 动态模型目录；Pi 走动态 thinkingLevels；Grok Build/OpenCode ACP 不支持 reasoning effort。新增 CLI --reasoning-effort，显式值覆盖 Profile 默认值，空值拒绝；同步更新 Agent Mux Skill 与生成器说明。

- 2026-08-07T06:12:38.195Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T06:40:08.384Z `debug and installed codem-agent-mux SHA-256`: pass: identical
- 2026-08-07T06:40:07.974Z `skill-creator quick_validate codem-agent-mux`: pass: Skill is valid

- 2026-08-07T06:40:07.575Z `installed codem-agent-mux invoke --reasoning-effort max --prompt original long read-only check`: pass: exit 0, 127.0.0.1:55432, no fake success, no 400
- 2026-08-07T06:40:07.160Z `installed codem-agent-mux invoke --reasoning-effort max --prompt Reply exactly OK`: pass: exit 0, OK

- 2026-08-07T06:40:06.752Z `debug codem-agent-mux invoke --reasoning-effort max --prompt Reply exactly OK`: pass: exit 0, OK
- 2026-08-07T06:40:06.357Z `cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass

- 2026-08-07T06:40:05.952Z `npm.cmd run typecheck`: pass
- 2026-08-07T06:40:05.553Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: pass: 16/16

- 2026-08-07T06:40:05.155Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass: 14/14
- 2026-08-07T06:40:04.754Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

## Completion Summary
- 2026-08-07T06:40:39.856Z 已新增 invoke --reasoning-effort <level>：显式参数优先覆盖 Profile reasoningEffort，未传时保持默认，空参数报错；Claude/Codex/Pi 使用各自 Provider 字段映射，ACP Provider 不硬编码支持。主 Agent 的 codem-agent-mux 技能及 CodeM 生成器已同步说明 Provider 差异。调试版和 LocalAppData 安装版均通过 max 短任务与原始长任务，14 项 Rust 测试、16 项 Agent Mux UI 测试、typecheck、格式检查、构建和技能校验通过；安装版与调试版哈希一致。

## Follow-ups

- 待补充。
