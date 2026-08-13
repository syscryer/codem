# Task: 工作流下线

## Background

工作流已经支持保存草稿、发布和正式运行，但已启用工作流缺少撤回正式入口的能力。用户需要在保留定义和历史记录的前提下，将不再希望被正式调用的工作流恢复为可编辑草稿。

## Objective

为已启用工作流增加带确认的下线操作，将状态安全地恢复为草稿并停止正式调用。

## Scope

In scope:

- 在已启用工作流卡片上提供下线入口。
- 使用 CodeM 现有主题确认弹窗说明下线影响。
- 确认后通过现有工作流更新接口将 `active` 状态改为 `draft`。
- 请求成功后同步卡片状态和更新时间，并禁用正式运行入口。
- 请求失败时保留原状态并展示真实错误。
- 保留工作流定义和已有运行记录。

Out of scope:

- 发布版本历史、审批流、回滚和定时下线。
- 删除工作流定义或清理运行历史。
- 改造工作流执行引擎和主聊天触发协议。

## Impact

- 前端工作流管理卡片新增下线操作和确认弹窗。
- 复用既有 `updateWorkflowDefinition` 持久化能力，不新增后端接口或数据结构。
- 下线后的工作流回到草稿，只能继续编辑或重新发布，不能正式运行。

## Acceptance Criteria

- [x] 已启用工作流卡片显示下线操作，草稿卡片不显示。
- [x] 下线前展示统一主题确认弹窗，明确正式启动入口失效且历史记录保留。
- [x] 确认后等待持久化成功，再将工作流状态更新为草稿。
- [x] 下线过程中确认按钮不可重复提交。
- [x] 接口失败不修改本地状态，并向用户显示真实错误。
- [x] 下线后卡片正式运行按钮不可用，工作流定义和运行记录不删除。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-13T02:58:50.336Z 已实现工作流下线：已启用卡片新增下线入口和主题确认弹窗；确认后复用 updateWorkflowDefinition 将 active 改为 draft，成功后禁用正式运行并保留定义与运行历史，失败时维持原状态并展示真实错误。

- 2026-08-13T02:55:42.288Z Task created by Trellis automation.

## Verification Results
- 2026-08-13T02:59:01.943Z `npm run typecheck; node --import tsx --test src/lib/workflow-prototype.test.ts; npm run build; git diff --check`: 全部通过：TypeScript 类型检查通过；工作流测试 8/8；生产构建通过（仅已有 Vite 警告）；diff whitespace 检查通过。

- `npm run typecheck`：通过。
- `node --import tsx --test src/lib/workflow-prototype.test.ts`：8/8 通过。
- `npm run build`：通过；仅保留已有的 Vite chunk-size 和 mixed import 警告。
- `git diff --check`：通过。
- 桌面开发窗口保持运行，Vite HMR 已加载本次前端修改；未构建或改动安装版。

## Completion Summary
- 2026-08-13T02:59:08.584Z 完成工作流下线功能：已启用工作流可经确认恢复为草稿，下线后禁止正式运行，保留工作流定义与历史记录，失败时保持原状态并显示真实错误。

已为已启用工作流补充下线入口和主题确认弹窗。下线成功后工作流从 `active` 恢复为 `draft`，卡片显示“刚刚下线”，正式运行入口随即禁用；工作流定义和历史运行记录保持不变。持久化失败时维持原状态并展示真实错误。

## Follow-ups

- 主聊天工作流匹配入口接入真实执行时，只允许匹配 `active` 工作流。
