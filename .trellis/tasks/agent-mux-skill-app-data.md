# Task: Agent Mux Skill 绑定桌面数据目录

## Background

同机同时运行 CodeM 安装版与 CodeM Dev 时，独立 CLI 默认解析到安装版数据目录，开发版生成的 Skill 可能把运行记录写入另一套 Runtime，导致桌面监控看不到调用。

## Objective

外部 Skill 始终调用生成它的 CodeM Runtime，避免开发版与安装版记录分叉

## Scope

In scope:

- Runtime 信息返回当前数据目录。
- 生成 Skill 的全部 CLI 命令显式携带当前数据目录。

Out of scope:

- 合并安装版与开发版的历史数据库。
- 自动迁移已经写入另一数据目录的测试记录。

## Impact

外部 Skill 始终连接生成它的 CodeM Runtime；单实例用户行为不变。

## Acceptance Criteria

- [x] Runtime API 返回 `appDataDir`。
- [x] Skill 的发现、调用、状态和取消命令携带 `--app-data`。
- [x] 数据目录为空时仍兼容 PATH/default 解析。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `node --import tsx --test src/lib/agent-mux-ui.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-08-05T12:23:54.543Z Runtime API 返回当前 appDataDir，生成 Skill 的发现、调用、状态和取消命令显式绑定数据目录；修复 CodeM 与 CodeM Dev 同机运行时记录写入错误数据库。

- 2026-08-05T12:17:14.108Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T12:23:57.123Z `desktop dev restart and external invoke`: pass: mux-3a6e73ab-3639-492a-8e9e-007dae28e789 caller OpenAI Codex summary DESKTOP_VISIBLE_OK
- 2026-08-05T12:23:56.471Z `npm run typecheck`: pass

- 2026-08-05T12:23:55.798Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: pass: 8/8
- 2026-08-05T12:23:55.173Z `cargo test agent_mux`: pass: 13/13 relevant tests

## Completion Summary
- 2026-08-05T12:24:13.180Z Agent Mux Skill 已绑定生成它的 CodeM 数据目录，修复安装版与开发版 Runtime 分叉；桌面重启和真实外部调用验证通过。

## Follow-ups

- 已安装 Skill 需要更新一次以写入绑定的数据目录。
