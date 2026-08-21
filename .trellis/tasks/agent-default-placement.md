# Task: 将默认 Agent 设置移入各 Agent 详情

## Background

待补充背景。

## Objective

移除顶部全局默认 Agent 控件，在每个 Agent 详情操作区提供设为默认入口，保持现有持久化和新聊天行为不变

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
- 2026-08-21T03:13:19.120Z 已将默认 Agent 控件移至各 Agent 详情操作区，复用原有 defaultProviderId 持久化路径；不可用或规划中的 Provider 禁止设为默认。

- 2026-08-21T01:58:44.613Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T03:13:19.156Z `npm run typecheck && npm run build && node --import tsx --test src/lib/agent-provider-management-ui.test.ts && git diff --check`: 类型检查、生产构建、18 个 Agent 设置回归用例和 diff 空白检查均通过；桌面开发版已实际确认默认徽标与设为默认按钮位置和可用性。

## Completion Summary
- 2026-08-21T03:13:34.278Z 默认 Agent 已从顶部全局选择器移至各 Agent 详情：当前默认显示徽标，其他可用 Provider 显示设为默认；持久化和新聊天默认 Provider 逻辑保持不变。

## Follow-ups

- 待补充。
