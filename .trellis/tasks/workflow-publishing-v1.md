# Task: 工作流发布与启用

## Background

工作流数据模型和管理页已支持 `draft` / `active` 两种状态，但编辑器只有保存草稿动作，无法产生已启用工作流，“已启用”筛选与徽标因此没有实际入口。

## Objective

为工作流增加轻量发布入口，将校验通过的草稿持久化为已启用状态，并支持发布更新和保存回草稿。

## Scope

In scope:

- 编辑器提供发布和发布更新动作。
- 保存草稿明确写入 `draft`，发布明确写入 `active`。
- 发布复用工作流结构校验，并拒绝已绑定但当前不可用的 Agent 配置。
- 保存和发布等待后端持久化成功后再更新编辑状态。
- 草稿禁止从管理卡片启动，已启用工作流才允许运行。

Out of scope:

- 不增加工作流版本表、发布历史、审批流和回滚。
- 不强制每个 Agent 节点显式绑定配置，未绑定节点仍允许运行时自动匹配。

## Impact

- 工作流编辑器工具栏、状态展示和管理卡片运行边界。
- 复用现有工作流持久化接口，无数据库结构变更。

## Acceptance Criteria

- [x] 校验通过的草稿可发布为已启用状态并持久化。
- [x] 已启用工作流修改后可发布更新，也可保存回草稿。
- [x] 发布失败不会错误显示为已发布或清除未保存状态。
- [x] 已绑定但不可用的 Agent 配置会阻止发布并显示具体节点。
- [x] 草稿运行入口禁用且动作层再次拦截，已启用工作流可运行。
- [x] 管理页已启用筛选和状态徽标使用真实持久化状态。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-13T02:37:36.824Z 工作流发布闭环已实现：发布/发布更新写入 active，保存草稿写入 draft；发布等待持久化成功，校验失效的显式 Agent 绑定，草稿禁止正式运行。

- 2026-08-13T02:32:51.944Z Task created by Trellis automation.
- 2026-08-13 增加发布、发布更新、编辑器状态徽标，并统一草稿/发布快照构建和校验。
- 2026-08-13 将编辑器保存回调改为等待持久化结果，失败时保持 dirty 状态。
- 2026-08-13 限制只有 `active` 工作流可从管理页启动，草稿保留编辑器预演能力。

## Verification Results
- 2026-08-13T02:37:54.092Z `npm run typecheck; node --import tsx --test src/lib/workflow-prototype.test.ts; npm run build; git diff --check`: 全部通过：类型检查、工作流测试 8/8、生产构建和 diff 检查；桌面开发窗口保持响应。

- `npm run typecheck`: passed.
- `node --import tsx --test src/lib/workflow-prototype.test.ts`: passed, 8/8 tests.
- `npm run build`: passed; only existing Vite chunk-size and mixed import warnings remain.
- `git diff --check`: passed; only existing CRLF conversion warnings remain.
- Desktop development window remained responsive after HMR.

## Completion Summary
- 2026-08-13T02:38:04.351Z 完成工作流轻量发布：支持草稿发布、发布更新、保存回草稿、发布校验和仅已启用工作流正式运行。

工作流现已具备轻量发布闭环：草稿保存、发布为已启用、发布更新、保存回草稿，以及仅允许已启用工作流正式运行。发布状态复用现有持久化字段，无版本管理复杂度。

## Follow-ups

- 后续如需要多版本、回滚或多人审批，再单独设计发布版本模型。
