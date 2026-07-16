# Task: 统一右键菜单目标高亮

## Background

当前部分列表项在右键打开菜单时没有显示菜单目标，用户无法判断操作会作用于当前打开项还是右键项。工作台文件树已经有独立的 `context-active` 状态，可以沿用同一状态语义补齐其他缺口。

## Objective

右键列表项时明确高亮菜单目标，不切换当前主内容，并检查全局同类交互一致性

## Scope

In scope:

- 左侧项目、Agent 会话和普通聊天在菜单打开期间显示临时目标态。
- Git 分支、工作台预览标签、对话输出文件和更改文件列表显示临时目标态。
- 保留工作台文件树已有目标态，以及 Git 提交、Git 文件已有的真实选中反馈。
- 菜单关闭后清除临时目标态，并补充回归测试。

Out of scope:

- 右键 Agent 会话或普通聊天时不切换当前主内容。
- 右键工作台标签时不切换当前预览。
- 不调整右键菜单命令、位置和数据行为。
- 不重构现有菜单或弹层体系。

## Impact

- Frontend：`SidebarProjects`、`GitHistoryPanel`、`RightWorkbench`、`ConversationTurn` 和共享样式。
- Backend / persistence：无影响。

## Acceptance Criteria

- [x] 右键未打开的会话时，目标行显示临时高亮，当前聊天内容不切换。
- [x] 左侧项目、普通聊天和 Agent 会话的菜单目标态保持一致。
- [x] Git 分支、工作台标签和对话文件列表的右键目标均有明确反馈。
- [x] 已有选中态和菜单目标态可以区分，菜单关闭后临时状态消失。
- [x] 工作台文件树和 Git 提交/文件的既有行为不回归。

## Verification Commands

- `npx tsx --test src/lib/context-menu-target-highlight.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-15T12:45:14.161Z 根据用户截图反馈，将所有 context-active 背景从 accent 混色改为 app-text 或 sidebar hover 的中性灰混色，继续保持无描边。

- 2026-07-15T12:36:32.493Z 按用户反馈统一移除 context-active 的蓝色描边，仅保留柔和主题背景；同步调整工作台文件树原有状态。
- 2026-07-15T12:30:51.654Z 完成全局右键目标盘点：工作台文件树已有 context-active，Git 提交和文件已有真实选中反馈；为侧栏项目/Agent 会话/普通聊天、Git 分支、工作台预览标签、对话输出文件和更改文件补充临时目标态，未改变主内容切换逻辑。

- 2026-07-15T12:25:00.663Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T12:45:16.103Z `Playwright 中性灰计算样式验证`: 右键目标背景为 rgba(36, 36, 36, 0.06)，RGB 三通道一致，box-shadow 为 none，当前会话未切换。
- 2026-07-15T12:45:15.160Z `npx tsx --test src/lib/context-menu-target-highlight.test.ts`: 3 个测试全部通过，并断言目标态规则不再引用 accent。

- 2026-07-15T12:36:36.252Z `Playwright 真实浏览器右键验证`: 未打开会话仅出现浅色 context-active 背景，box-shadow 为 none；activeThread 保持不变，点击菜单外部后菜单和临时状态均清除。
- 2026-07-15T12:36:35.329Z `git diff --check`: 通过，仅输出工作区既有 LF/CRLF 提示。

- 2026-07-15T12:36:34.393Z `npm run typecheck`: 通过，TypeScript 无类型错误。
- 2026-07-15T12:36:33.446Z `npx tsx --test 定向右键菜单相关测试`: 46 个测试全部通过，0 失败。

## Completion Summary

- 2026-07-15T12:45:16.975Z 右键目标态已统一为无描边中性灰背景，不再偏蓝。
- 2026-07-15T12:36:37.110Z 统一列表右键菜单目标反馈：补齐侧栏、Git 分支、工作台标签和对话文件目标态，保留现有选中语义，仅使用无描边的柔和背景，并完成自动化与浏览器验证。

## Follow-ups

- 无。
