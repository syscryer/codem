# Task: 修复移动伴侣设置首次加载失败

## Background

待补充背景。

## Objective

移动伴侣设置首次进入时遇到瞬时网络失败应自动恢复，且旧请求不能覆盖新状态

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
- 2026-08-17T05:58:31.533Z 移动伴侣设置 status 首次请求增加网络型失败的短重试（最多 3 次），并用 request id 忽略 React StrictMode/重复刷新产生的过期响应；仅修改 src/components/settings/MobileCompanionSettings.tsx。

- 2026-08-17T05:58:18.237Z Task created by Trellis automation.

## Verification Results
- 2026-08-17T05:58:34.623Z `git diff --check -- src/components/settings/MobileCompanionSettings.tsx`: pass

- 2026-08-17T05:58:33.590Z `node --import tsx --test src/mobile/**/*.test.ts src/mobile/*.test.ts src/lib/client-id.test.ts src/lib/agent-run-events.test.ts (50 passed)`: pass
- 2026-08-17T05:58:32.528Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-17T05:58:35.709Z 移动伴侣设置首次加载失败修复完成：短暂网络失败自动重试，过期请求不会覆盖最新状态；当前 CodeM 设置页已验证正常。

## Follow-ups

- 待补充。
