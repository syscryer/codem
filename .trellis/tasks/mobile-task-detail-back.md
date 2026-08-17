# Task: 修复移动任务详情返回关闭页面

## Background

移动任务详情页顶部“任务”返回按钮使用 `history.length > 1 ? history.back() : ...`。手机浏览器和微信 WebView 的 history 长度包含打开 CodeM 之前的页面，直接进入详情时点击返回会离开 CodeM，部分容器表现为关闭页面。

## Objective

让详情页顶部返回稳定回到任务列表，不退出手机浏览器或微信 WebView

## Scope

In scope:

- 详情页顶部返回按钮确定性地替换到 `/mobile/tasks`。
- 增加回归测试，禁止详情页重新依赖 `history.back()` 或 `history.length`。

Out of scope:

- 修改手机系统返回键、浏览器手势或弹层自己的历史记录语义。
- 修改桌面端路由和界面。

## Impact

- `src/mobile/MobileApp.tsx`
- `src/mobile/mobile-conversation-reuse.test.ts`

## Acceptance Criteria

- [x] 从任务列表进入详情后，点击顶部“任务”回到任务列表。
- [x] 通过收藏、二维码、通知或外部链接直接进入详情时，点击顶部“任务”不会关闭页面。
- [x] 微信 WebView 与普通手机浏览器使用相同行为。
- [x] 不影响系统返回键、移动弹层和桌面端。

## Verification Commands

- `node --import tsx --test src/mobile/mobile-conversation-reuse.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-16T12:17:30.686Z 详情页顶部 任务按钮改为 replaceRoute(/mobile/tasks)，不再根据 history.length 调用 history.back；新增直接进入详情和 WebView 退出回归约束。

- 2026-08-16T12:15:07.012Z Task created by Trellis automation.

## Verification Results

- 2026-08-16T12:17:36.387Z `git diff --check`: 通过，仅有既有 CRLF 转换提醒。
- 2026-08-16T12:17:34.973Z `新版移动静态资源与服务访问`: MobileApp-DmVpF0kX.js 包含安全任务列表返回且不含 history.length；局域网 /mobile/tasks 返回 200，Runtime 继续监听 0.0.0.0:3210。

- 2026-08-16T12:17:33.534Z `npm run typecheck && npm run build`: 通过，TypeScript 无错误，Vite 生产构建成功。
- 2026-08-16T12:17:32.083Z `node --import tsx --test src/mobile/mobile-conversation-reuse.test.ts`: 通过，21 个移动会话/导航测试全部成功。

## Completion Summary
- 2026-08-16T12:17:37.825Z 移动任务详情顶部返回现在确定性回到 /mobile/tasks，不再退出手机浏览器或微信 WebView；新增导航回归测试并完成类型、构建和实际服务验证。

## Follow-ups

- 无。
