# Session Record: 修复使用统计聚合与今日归因

- Session: session-20260718-190621-pyhp
- Started: 2026-07-18T19:06:21.961Z
- Task: .trellis/tasks/usage-statistics-attribution.md

## Notes
- 2026-07-18T19:16:06.312Z 确认两处根因：按 Agent 筛选时逐会话行未按模型二次聚合；前端固定日窗口使用 UTC 日期而后端按本地日期过滤。已改为同供应商内按模型名忽略大小写聚合，并让趋势窗口使用浏览器本地日期。

- 2026-07-18T19:06:21.965Z Session started.

## Verification
- 2026-07-18T19:23:30Z `桌面开发版真实本机数据烟测`: 通过；最近 30 天 Claude 统计返回 5 个供应商分组、7 个唯一模型行，无重复模型名；今日汇总、供应商和项目均为 0，与本地 7/19 口径一致。

- 2026-07-18T19:16:09.638Z `npm run typecheck；rustfmt --edition 2021 --check src-tauri/src/backend.rs；git diff --check（任务相关文件）`: 通过；TypeScript、Rust 目标文件格式和差异空白检查无错误。

- 2026-07-18T19:16:08.007Z `cargo test --manifest-path src-tauri/Cargo.toml usage_provider_rows`: 通过，1/1；同名模型从逐会话行聚合为单行，Token、会话和最近使用时间正确合并。
- 2026-07-18T19:16:07.109Z `node --import tsx --test src/lib/usage-trend.test.ts`: 通过，5/5；覆盖今日范围及新加坡本地日期跨 UTC 日界。

## Completed

- 2026-07-18T19:16:10.684Z 修复使用统计重复模型与今日日期口径：按 Agent 筛选时相同模型合并为单行，趋势图与汇总/渠道/项目统一使用本地日期。
