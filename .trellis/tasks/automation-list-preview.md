# Task: 增强自动化列表预览信息

## Background

自动化列表已支持选中和删除，但用户还需要在不打开编辑区的情况下快速判断所属项目和下一次执行时间。

## Objective

继续优化自动化列表宽度，并展示项目名称、路径和下一次执行时间

## Scope

In scope:

- 适度增加自动化列表宽度。
- 展示项目名称、项目路径和下一次执行时间，并对长路径做截断与悬停提示。
- 保持现有删除、选中和响应式交互不变。

Out of scope:

- 不调整调度计算、持久化或运行链路。

## Impact

- 前端自动化列表组件、样式和专项静态测试。

## Acceptance Criteria

- [x] 列表在桌面和窄窗口下均保持可用，左侧预览空间适度增加。
- [x] 每条自动化显示项目名称、项目路径和下一次执行时间。
- [x] 长路径不撑破布局，并提供完整路径提示。
- [x] 回归测试、类型检查、构建和 diff 检查通过。

## Verification Commands

- `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-api.test.ts src/lib/automation-schedule.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-18T03:27:36.331Z 自动化列表进一步加宽，增加项目名称、项目路径和频率/下次执行时间预览；长路径使用截断和悬停提示。

- 2026-07-18T03:26:41.654Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T03:27:45.117Z `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-api.test.ts src/lib/automation-schedule.test.ts; npm run typecheck; npm run build; git diff --check`: 专项测试17/17通过，typecheck通过，Vite build通过，diff检查通过。

## Completion Summary
- 2026-07-18T03:27:52.796Z 完成自动化列表预览增强：左侧列表适度加宽，展示项目名称、路径和频率/下次执行时间，长路径支持截断和悬停查看；专项测试17/17、typecheck、build、diff检查通过。

## Follow-ups

- 待补充。
