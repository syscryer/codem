# Task: 优化自动化列表与删除操作

## Background

自动化中心已有可编辑列表和底部删除操作，但列表横向空间偏紧，列表项缺少就地删除入口，页面交互状态还需要统一整理。

## Objective

加宽自动化列表，增加每条自动化的删除入口，并统一自动化页面的交互与视觉状态

## Scope

In scope:

- 将自动化列表轨道适度加宽，并保留窄窗口下的响应式布局。
- 为每条自动化增加独立删除按钮，沿用二次确认并阻止误触选中。
- 统一列表 hover、选中、删除和键盘焦点状态，兼容现有主题变量。

Out of scope:

- 不调整自动化持久化、调度、运行和历史记录逻辑。
- 不引入新的视觉主题或第三方 UI 组件。

## Impact

- 前端组件、自动化列表样式和 UI 静态测试；不涉及 Rust API 变更。

## Acceptance Criteria

- [x] 列表宽度适度增加，编辑区仍可用且保留响应式断点。
- [x] 每条自动化有带确认的删除入口，删除按钮不会触发列表选中。
- [x] 选中、hover、危险操作和键盘 focus 状态清晰且使用主题变量。
- [x] 现有自动化专项测试、类型检查、构建和 diff 检查通过。

## Verification Commands

- `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-api.test.ts src/lib/automation-schedule.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-18T03:18:41.610Z 自动化列表增加同级删除按钮，复用二次确认逻辑；列表宽度提升并补充删除、选中和键盘焦点状态。

- 2026-07-18T03:14:52.277Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T03:18:48.549Z `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-api.test.ts src/lib/automation-schedule.test.ts; npm run typecheck; npm run build; git diff --check`: 专项测试16/16通过，typecheck通过，Vite build通过，diff检查通过；Playwright未执行，原因是当前运行层未安装Chromium。

## Completion Summary
- 2026-07-18T03:19:32.724Z 完成自动化列表视觉和交互优化：列表适度加宽，每条自动化提供独立确认删除按钮，补充 hover、选中、危险操作和键盘焦点状态；专项测试16/16、typecheck、build、diff检查通过。

## Follow-ups

- 待补充。
