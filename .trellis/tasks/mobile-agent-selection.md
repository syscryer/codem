# Task: 移动端 Agent 选择交互

## Background

待补充背景。

## Objective

明确移动端新建任务与已有任务的 Agent 选择语义，确保可选择项真实可用且已有热会话不被错误切换

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
- 2026-08-15T18:47:52.719Z 确认桌面端 Provider 在已有线程创建后锁定；移动端任务详情改为可点击的锁定说明，新建任务保留全部 Provider 并对不可用项显示原因；未改动桌面前端或 Agent 后端协议。

- 2026-08-15T18:36:12.047Z Task created by Trellis automation.

## Verification Results
- 2026-08-15T18:47:53.250Z `npm run typecheck && node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts && npm run build`: typecheck 通过；移动端 28/28 测试通过；Vite 生产构建通过。

## Completion Summary
- 2026-08-15T18:47:53.724Z 移动端 Agent 选择语义与交互已完成：已有任务明确提示 Agent 创建后锁定，新建任务展示可用与不可用 Provider，避免空列表误导；桌面端与后端协议保持不变。

## Follow-ups

- 待补充。
