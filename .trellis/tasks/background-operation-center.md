# Task: 后台任务中心

## Background

Git 获取远端、拉取和推送可能持续较长时间，原界面关闭操作弹窗后无法继续查看过程和结果，重复点击也缺少统一的运行态约束。

## Objective

在标题栏提供安静的后台任务中心，集中展示 Git 长耗时操作的运行、成功和失败状态，并让触发入口同步显示运行中状态。

## Scope

In scope:

- 记录 Git fetch、pull、push 的运行状态和最近结果。
- 标题栏展示任务中心、运行数量和未读失败提示。
- Git 菜单、侧栏菜单和推送弹窗复用同一运行状态并阻止重复执行。

Out of scope:

- 不持久化跨启动的后台任务历史。
- 不改变 Git 命令、冲突处理和认证流程。

## Impact

- 前端新增后台操作状态模型、hook 和标题栏弹层。
- Git 推送提升到 App 层执行，使弹窗关闭后仍可追踪结果。

## Acceptance Criteria

- [x] fetch、pull、push 运行时入口有明确状态且不能重复触发。
- [x] 任务中心能查看运行、成功和失败结果。
- [x] 失败产生未读提示，打开任务中心后标记为已读。
- [x] 清除已完成不会删除仍在运行的任务。

## Verification Commands

- `node --test --import tsx src/lib/background-operations.test.ts src/lib/background-operation-ui.test.ts`
- `npm run typecheck`

## Implementation Record

- 2026-07-21T05:51:31.121Z 实现后台任务状态模型、标题栏任务中心和 Git 操作运行态接入；推送由 App 层持有，关闭弹窗后仍可查看结果。

## Verification Results

- 2026-07-21T05:51:31.467Z 后台任务相关测试 9/9 通过。
- 2026-07-21T05:51:31.150Z `npm run typecheck` 通过。

## Completion Summary

- 2026-07-21T05:52:11.953Z 完成后台任务中心首版，并在后续视觉调整中使用铃铛入口和局部玻璃弹层。

## Follow-ups

- 后续其他长耗时操作可在需求明确后接入同一状态模型。
