# Task: 浏览器加载进度反馈

## Background

内置浏览器导航、刷新或前进后退时没有可见反馈，网络较慢时用户无法判断操作是否已经触发。

## Objective

在浏览器工作台导航和刷新期间显示非阻塞的加载进度指示

## Scope

In scope:

- 导航、刷新、前进和后退时显示非阻塞的加载进度条。
- 地址轮询确认后收起进度，异常、切换页面和超时场景清理状态。
- 使用主题 token，并支持减少动态效果偏好。

Out of scope:

- 不改变 Tauri 原生 WebView 的导航协议。
- 不展示无法从 WebView API 获得的伪百分比进度。

## Impact

- 仅影响浏览器工作台组件和对应局部样式。

## Acceptance Criteria

- [x] 浏览器导航相关操作立即出现加载反馈。
- [x] 加载反馈不会阻塞地址栏和其他浏览器控件。
- [x] 异常和离开浏览器工作台时不会遗留加载状态。

## Verification Commands

- `node --test --import tsx src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-21T09:58:18.802Z 为浏览器工作台增加局部加载状态：导航、刷新和前进后退立即显示顶部流动进度条，地址轮询后收起；异常路径和切换标签时清理状态。

- 2026-07-21T09:58:04.127Z Task created by Trellis automation.

## Verification Results

- 2026-07-21T09:58:18.790Z `git diff --check`: 通过；仅有 Git 换行提示
- 2026-07-21T09:58:18.759Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-21T09:58:29.877Z 浏览器工作台已增加非阻塞加载进度条，覆盖导航、刷新、前进后退及异常清理；浏览器相关测试 9/9、typecheck、git diff --check 通过。

## Follow-ups

- 如果 Tauri 后续暴露原生页面加载事件，可用事件替代当前地址轮询完成信号。
