# Task: 会话历史自动分页加载

## Background

待补充背景。

## Objective

将长会话历史从点击加载改为接近顶部时自动分页，并保持滚动视口稳定

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
- 2026-07-16T16:17:21.361Z 会话历史改为接近顶部 240px 时自动加载前 60 轮；加载前记录 scrollHeight/scrollTop，渲染后补偿新增高度以保持视口稳定；移除手动加载按钮。

- 2026-07-16T16:16:03.928Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T16:17:21.656Z `node --import tsx --test src/**/*.test.ts && npm run typecheck && npm run build`: 通过：前端 509/509，类型检查和生产构建成功。

## Completion Summary
- 2026-07-16T16:17:21.942Z 自动历史分页完成：向上滚动自动加载，无需点击，并保持当前阅读位置稳定。

## Follow-ups

- 待补充。
