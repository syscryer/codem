# Task: 修复一次性自动化失败重试与时间校验

## Background

待补充背景。

## Objective

确保 custom 自动化执行失败可重试，成功后才停用，并在表单中即时校验过去的自定义时间

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
- 2026-07-18T03:59:01.610Z 修复 custom 自动化领取语义：领取时保留一次性任务的启用和到期状态，失败后可重试，运行完成时事务内停用；自动化表单复用调度计算即时阻止过去的自定义时间并展示错误。

- 2026-07-18T03:54:27.528Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T03:59:46.894Z `npm run typecheck && npm run build && git diff --check`: 类型检查、生产构建、差异空白检查均通过

- 2026-07-18T03:59:46.685Z `node --import tsx --test src/lib/automation-schedule.test.ts src/lib/automation-ui.test.ts`: 17/17 通过
- 2026-07-18T03:59:46.649Z `cargo test automation::tests --manifest-path src-tauri/Cargo.toml`: 4/4 通过

## Completion Summary
- 2026-07-18T04:00:26.389Z done

## Follow-ups

- 待补充。
