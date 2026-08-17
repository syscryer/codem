# Task: 修复移动新建任务返回无响应

## Background

移动端新建任务页的“任务”返回按钮只调用 `history.back()`。iPhone 内嵌浏览器、PWA 桌面图标、刷新或直接链接进入 `/mobile/new` 时可能没有可用的同页历史，因此点击后无响应；桌面浏览器通常已有历史，所以不易复现。

## Objective

让移动端新建任务页在无可用浏览器历史和 PWA 场景下稳定返回任务列表，不影响桌面端。

## Scope

In scope:

- 新建任务页的返回按钮稳定回到 `/mobile/tasks`。
- 返回时替换当前新建页历史，避免系统返回再次进入新建页。
- 增加移动导航回归测试。

Out of scope:

- 修改桌面端路由或组件。
- 重构移动端完整路由系统。

## Impact

- Mobile frontend only: `src/mobile/MobileApp.tsx` 和现有移动静态回归测试。

## Acceptance Criteria

- [x] 无可用浏览器历史时，点击新建任务页“任务”按钮仍进入 `/mobile/tasks`。
- [x] 返回不新增一条会再次进入 `/mobile/new` 的历史记录。
- [x] 桌面端入口和组件不受影响。
- [x] TypeScript、移动定向测试和生产构建通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-16T01:24:14.932Z 确认 iPhone 内嵌浏览器/PWA 场景下 history.back 没有可靠目标；新建任务返回改为 replaceState('/mobile/tasks') 并同步更新路由状态，避免无响应和返回回弹。

- 2026-08-16T01:23:20.610Z Task created by Trellis automation.

## Verification Results
- 2026-08-16T01:25:14.928Z `npm run typecheck; node --import tsx --test src/mobile/mobile-conversation-reuse.test.ts; npm run build; git diff --check`: 通过：TypeScript 检查成功，移动导航及会话定向测试 17/17，Vite 生产构建成功，diff 无 whitespace error。新建页返回使用 replaceState 直接进入 /mobile/tasks，不依赖微信内置浏览器 history.back。

## Completion Summary
- 2026-08-16T01:25:22.658Z 修复微信内置浏览器中移动新建任务页返回无响应：按钮改为 replaceState 直接返回任务列表并同步 React 路由状态，避免依赖不可用的 history.back 及历史回弹；仅修改移动端入口并补充回归测试。

## Follow-ups

- 无。
