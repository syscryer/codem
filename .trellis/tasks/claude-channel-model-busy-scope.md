# Task: 隔离 Claude 模型按钮忙碌状态

## Background

模型行的 1M、默认和启用操作复用了渠道页面级 `busy` 状态。模型更新期间，上方渠道配置区按钮也会进入禁用态并发生视觉闪动，实际影响范围大于正在执行的模型行操作。

## Objective

点击 1M、默认或启用等模型行操作时，只改变模型行状态，不让渠道配置区按钮闪烁。

## Scope

In scope:

- 为模型更新增加独立忙碌状态，只锁定模型相关操作。
- 保持渠道保存、测试、删除等页面级忙碌状态的既有边界。
- 模型更新完成后继续使用局部模型列表更新，不刷新整个渠道表单。

Out of scope:

- 不修改模型更新 API、持久化结构或渠道业务规则。
- 不重构设置页其他异步操作的忙碌状态。

## Impact

- Frontend：`AgentChannelSettings` 模型操作状态与按钮禁用范围。
- Backend / Persistence：无变化。

## Acceptance Criteria

- [x] 点击 1M、默认或启用操作时，仅模型区进入忙碌态。
- [x] 渠道配置区按钮不再因模型更新闪烁或短暂禁用。
- [x] 模型更新失败时错误可见，忙碌状态能够恢复。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-11T16:23:23.441Z 确认真实视觉闪动来自 patchModel 复用页面级 busy；新增独立 patchingModelId，仅锁定模型区，渠道配置区不再切换 disabled 状态。

- 2026-08-11T16:21:01.408Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T16:23:57.685Z `git diff --check`: 通过；仅有换行提示

- 2026-08-11T16:23:57.669Z `npm run build`: 通过；仅有既有 Vite chunk 提示
- 2026-08-11T16:23:57.640Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-11T16:24:11.263Z 修复模型行操作触发上方渠道按钮闪动：patchModel 使用独立 model busy，仅模型区进入忙碌态；保留模型局部数据更新和渠道表单稳定依赖。

## Follow-ups

- 暂无。
