# Task: 排查长任务运行界面卡顿

## Background

待补充背景。

## Objective

定位并修复长时间运行任务导致界面逐渐卡顿的问题

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

- 2026-07-04T08:48:57.682Z 实现长任务卡顿优化：去掉 stream 每行 clockNowMs 状态更新，debug/raw 日志改为 100ms 批量 flush，ConversationPane 仅为可回滚变更 turn 构造 previousTurns，并 memo 化 ConversationTurn visibleItems。
- 2026-07-04T08:42:58.846Z 定位长任务卡顿热点：stream 每行刷新 clockNowMs、debug/raw 每事件更新 threadDetails、ConversationPane 每个 turn 传 slice 导致 memo 失效并产生 O(n^2) 分配。

- 2026-07-04T08:30:06.102Z Task created by Trellis automation.

## Verification Results
- 2026-07-04T08:49:07.769Z `node --test src/components/ConversationPane.render-perf.test.ts src/hooks/useClaudeRun.send-latency.test.ts src/hooks/useWorkspaceState.log-batching.test.ts；npm run typecheck；git diff --check`: 通过：10 个针对测试通过，typecheck 通过，diff 空白检查通过。

## Completion Summary
- 2026-07-04T08:49:17.681Z 已定位并修复长任务运行久后界面卡顿的主要前端热点：降低 stream/log 高频状态更新，避免会话 turn props 不稳定导致旧消息反复渲染，并补充性能护栏测试。

## Follow-ups

- 待补充。
