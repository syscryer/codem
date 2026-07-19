# Task: 修复使用统计聚合与今日归因

## Background

使用情况页在按 Agent 筛选时，会把逐会话统计重新组装为“提供商 / 模型”卡片。当多个会话使用同一模型时，现有逻辑只追加模型行，导致 `glm-5.2` 等同名模型重复展示。同时，后端“今日”按本地日期过滤，前端趋势窗口却按 UTC 日期取值，在本地日期已跨天、UTC 尚未跨天时，会出现汇总/渠道/项目为 0，趋势图却仍显示昨日数据的口径冲突。

## Objective

合并重复模型统计，并让今日统计正确展示渠道、模型和项目归因

## Scope

In scope:

- 供应商分组内按规范化模型名二次聚合，合并 Token、费用、耗时、会话和工具数。
- 前端固定日窗口使用浏览器本地日期，与后端 SQLite `localtime` 口径一致。
- 补充按 Agent 筛选时同名模型聚合和跨 UTC 日界的回归测试。

Out of scope:

- 不改变历史 usage 原始记录、费用计算或 Agent 运行机制。
- 不引入新的统计维度或普通聊天统计。

## Impact

- Backend: 调整 `build_usage_provider_rows` 的模型聚合。
- Frontend: 调整趋势固定日窗口的本地日期解析。
- Persistence: 无 schema 变更，只读现有统计记录。

## Acceptance Criteria

- [x] 按单个 Agent 筛选时，同一供应商下相同模型只展示一行，数值为所有相关会话之和。
- [x] “今日”汇总、趋势、渠道/模型和项目明细使用同一本地日期口径。
- [x] 7/30/90 天和全部历史的现有聚合不回归。

## Verification Commands

- `node --import tsx --test src/lib/usage-trend.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml usage_provider_rows`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-18T19:16:06.312Z 确认两处根因：按 Agent 筛选时逐会话行未按模型二次聚合；前端固定日窗口使用 UTC 日期而后端按本地日期过滤。已改为同供应商内按模型名忽略大小写聚合，并让趋势窗口使用浏览器本地日期。

- 2026-07-18T19:06:21.963Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T19:23:30Z `桌面开发版真实本机数据烟测`: 通过；最近 30 天 Claude 统计返回 5 个供应商分组、7 个唯一模型行，无重复模型名；今日汇总、供应商和项目均为 0，与本地 7/19 口径一致。

- 2026-07-18T19:16:09.638Z `npm run typecheck；rustfmt --edition 2021 --check src-tauri/src/backend.rs；git diff --check（任务相关文件）`: 通过；TypeScript、Rust 目标文件格式和差异空白检查无错误。

- 2026-07-18T19:16:08.007Z `cargo test --manifest-path src-tauri/Cargo.toml usage_provider_rows`: 通过，1/1；同名模型从逐会话行聚合为单行，Token、会话和最近使用时间正确合并。
- 2026-07-18T19:16:07.109Z `node --import tsx --test src/lib/usage-trend.test.ts`: 通过，5/5；覆盖今日范围及新加坡本地日期跨 UTC 日界。

## Completion Summary
- 2026-07-18T19:16:10.684Z 修复使用统计重复模型与今日日期口径：按 Agent 筛选时相同模型合并为单行，趋势图与汇总/渠道/项目统一使用本地日期。

## Follow-ups

- 暂无。
