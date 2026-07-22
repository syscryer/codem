# Task: 修复 CMD 标签激活

## Background

终端与 Git 日志共用底部 Dock。顶部 CMD 按钮当前只根据 Dock 是否打开决定高亮和开关，
因此 Git 日志处于活动状态时点击 CMD 不会激活终端，界面仍停留在 Git 历史。

## Objective

从 Git 历史打开 CMD 时切换到对应终端标签

## Scope

In scope:

- 统一顶部 CMD 按钮的活动态、提示和点击行为。
- Git 日志激活时点击 CMD，切换到已有或自动创建的终端标签。
- 为 Dock 活动态判定补充聚焦回归测试。

Out of scope:

- 调整终端会话创建、持久化和 PTY 生命周期。
- 修改 Git 历史内容或底部标签视觉样式。

## Impact

- 仅影响工作台顶部 CMD 按钮与底部 Dock 的面板切换状态。
- 不改变直接点击底部 Git 日志、终端标签和关闭按钮的现有行为。

## Acceptance Criteria

- [x] Dock 关闭时点击 CMD，会打开 Dock 并显示终端。
- [x] Git 日志处于活动状态时点击 CMD，会保持 Dock 打开并切换到终端。
- [x] 终端处于活动状态时点击 CMD，会关闭 Dock。
- [x] CMD 按钮只在终端实际显示时呈现活动态和“隐藏终端”提示。

## Verification Commands

- `node --import tsx --test src/lib/terminal-dock-state.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-21T16:25:32.072Z 修正顶部 CMD 入口：仅在终端面板实际显示时执行关闭；Dock 关闭或 Git 日志激活时均打开并切换到 terminal，同时同步按钮活动态与提示。

- 2026-07-21T16:22:07.767Z Task created by Trellis automation.

## Verification Results
- 2026-07-21T16:26:01.102Z `git diff --check`: 通过：无空白错误，仅有仓库行尾转换提示。

- 2026-07-21T16:25:54.070Z `npm run typecheck`: 通过：TypeScript 项目检查无错误。
- 2026-07-21T16:25:41.469Z `node --import tsx --test src/lib/terminal-dock-state.test.ts`: 通过：5 项测试全部通过，覆盖 Dock 关闭、Git 日志激活和终端激活状态。

## Completion Summary
- 2026-07-21T16:26:34.648Z 修复顶部 CMD 入口与共享 Dock 的状态判断；从 Git 日志点击 CMD 现在会激活终端，终端已激活时仍可正常关闭 Dock。聚焦测试、类型检查和 diff 检查均通过。

## Follow-ups

- 无。
