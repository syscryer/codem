# Task: 修复 Claude 渠道 1M 开关局部刷新

## Background

Claude 自定义模型的 1M 开关通过模型更新接口保存后，页面会重新同步整个渠道列表。渠道表单的同步 effect 依赖包含模型列表的渠道对象，因此模型行局部变化也会重建上方渠道 draft，造成用户正在编辑的配置区被重置。

## Objective

点击 Claude 自定义模型的 1M 开关时，仅更新模型行，不重置上方渠道配置区和表单状态。

## Scope

In scope:

- 模型更新成功后只替换当前渠道的模型列表。
- 渠道表单同步只依赖渠道稳定配置字段和渠道 ID 结构，不因模型列表变化而重建 draft。
- 保持创建渠道、切换渠道和渠道配置变化时的既有同步行为。

Out of scope:

- 不修改模型更新 API、数据库结构或 Claude 1M 声明规则。
- 不调整其他设置页面的表单同步策略。

## Impact

- Frontend：渠道模型局部状态更新、设置页 props 透传和渠道表单同步依赖。
- Backend / Persistence：无变化。

## Acceptance Criteria

- [x] 点击 Claude 自定义模型 1M 开关后，模型行状态立即更新。
- [x] 模型行更新不会重置渠道名称、地址等未保存 draft。
- [x] 切换渠道或渠道稳定配置变化时，表单仍能正确同步。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-11T15:58:18.505Z 将渠道表单同步 effect 改为依赖当前渠道稳定配置字段和渠道 ID 结构，模型列表局部更新不再重置上方 draft。

- 2026-08-11T15:55:43.450Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T16:00:05.431Z `git diff --check`: 通过；仅有 Git 的换行提示

- 2026-08-11T16:00:05.412Z `npm run build`: 通过；Vite 仅保留既有 chunk 大小提示
- 2026-08-11T16:00:05.405Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-11T16:00:16.779Z 修复 Claude 渠道模型 1M 开关触发上方配置区重置：表单同步只监听渠道配置字段与渠道列表结构，模型局部更新不再触发 draft 重建。

## Follow-ups

- 暂无。
