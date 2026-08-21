# Task: 优化桌面启动串行等待

## Background

待补充背景。

## Objective

缩短首屏从 WebView 到应用加载态的等待，同时保持后端请求在服务就绪后发送

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
- 2026-08-21T01:24:27.082Z 将后端就绪等待改为后台 Promise：应用先挂载并显示加载态，桌面 API 请求在发送前等待后端就绪；健康检查收到 401 时视为服务已启动，避免错误认证导致完整 8 秒等待。

- 2026-08-21T01:22:39.309Z Task created by Trellis automation.

## Verification Results

- 2026-08-21T01:24:27.619Z `npm run typecheck`: 通过
- 2026-08-21T01:24:27.352Z `node --import tsx --test src/lib/api-fetch-bridge.test.ts src/lib/desktop-startup-shell.test.ts`: 6 个测试全部通过

## Completion Summary
- 2026-08-21T01:24:27.924Z 完成启动性能优化：前端首屏不再串行等待后端健康检查，API 请求保留就绪闸门；认证服务已启动时不再因 401 空转 8 秒。

## Follow-ups

- 待补充。
