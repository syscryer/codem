# Task: 修复移动端登录后浏览器空白

## Background

待补充背景。

## Objective

登录成功后同步更新 MobileApp 路由状态，避免 /mobile/browser 登录后仍显示空白浏览器页

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record
- 2026-08-22T02:20:05.392Z 修复 ConnectPage 登录成功后只改 history、不更新 MobileApp React 路由的问题；改由 MobileApp 调用 replaceRoute('/mobile/tasks') 统一同步 URL 与页面状态。

- 2026-08-22T02:18:05.788Z Task created by Trellis automation.

## Verification Results
- 2026-08-22T06:05:00.000Z `复核 review（ZCode）`: 两个修复均确认正确：登录路由同步（ConnectPage 去掉裸 history.replaceState，由 MobileApp 的 onAuthenticated 统一 refresh + replaceRoute，URL 与 React 状态一致）；网关 CSP 补 frame-src 'self' http: https:（原 default-src 'self' 会在生产网关下静默禁掉浏览器 Tab 的全部外部 iframe，此前只在 vite dev 无 CSP 环境测试未暴露）。CSP 断言测试的调整意图保持不变（img-src 仍不允许远程图片）。`npm run typecheck` 通过；`node --import tsx --test`（mobile-browser/conversation-reuse/startup-cache）35 个通过；`cargo test --lib mobile_companion` 46 个通过。

- 2026-08-22T02:22:34.045Z `Playwright 登录后页面检查`: 使用临时密码登录成功后，地址栏进入 /mobile/tasks，页面显示任务列表，不再停留在空白浏览器页

- 2026-08-22T02:20:05.633Z `node --import tsx --test src/mobile/mobile-browser.test.ts`: 8 个测试通过
- 2026-08-22T02:20:05.388Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-22T02:22:34.302Z 修复移动端登录成功后的路由状态不同步：由 MobileApp 统一调用 replaceRoute('/mobile/tasks')，验证 typecheck、移动浏览器测试和 Playwright 登录流程通过。

## Follow-ups

- 待补充。
