# Task: 补充自动化自定义执行计划

## Background

待补充背景。

## Objective

为自动化中心增加一次性自定义日期时间计划，移除无交互的执行计划图标，并保持已有周期计划兼容

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
- 2026-07-18T03:04:52.612Z 实现自定义一次性执行计划：前端支持日期和时间输入，周期计划领取继续计算下一次时间；自定义计划领取时不提交下一次时间，Rust 后端在同一事务内清空 next_run_at_ms 并停用，保证只执行一次。移除无交互的 CalendarClock 装饰图标，状态点增加悬停说明。

- 2026-07-18T02:55:53.030Z Task created by Trellis automation.

## Verification Results

- 2026-07-18T03:04:53.615Z `Playwright 自动化中心实测`: 自定义标签可切换，日期和时间输入可见，装饰图标已移除，未保存用户数据
- 2026-07-18T03:04:53.275Z `npm run typecheck && npm run build && git diff --check`: 通过；仅有既有 Vite 分包大小提示

- 2026-07-18T03:04:52.943Z `cargo test --manifest-path src-tauri/Cargo.toml automation`: 4 passed
- 2026-07-18T03:04:52.591Z `node --import tsx --test src/lib/automation-schedule.test.ts src/lib/automation-ui.test.ts src/lib/automation-api.test.ts`: 15 passed

## Completion Summary
- 2026-07-18T03:05:07.000Z 自动化执行计划新增自定义一次性日期时间；到点领取后原子停用，避免重复执行。移除无交互的日历图标，状态点增加说明。专项测试、Rust 测试、类型检查、构建、diff 校验和 Playwright 实测通过，桌面开发版已热重载。

## Follow-ups

- 待补充。
