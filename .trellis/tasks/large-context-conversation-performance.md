# Task: 优化大上下文会话流畅度

## Background

长上下文会话在流式输出、切换会话和滚动时会出现明显卡顿。当前会话区一次挂载全部 turns，流式 delta 又会触发完整 Markdown 解析、自动滚动测量和整段历史持久化。本任务优先降低活动会话的主线程工作量，同时保持完整历史可访问。

## Objective

在不改变现有会话操作体验的前提下，隔离流式更新、限制流式渲染工作集，并建立长上下文性能回归基线

## Scope

In scope:

- 会话历史渐进展示，默认优先挂载最近 turns，用户可继续显示更早内容。
- 流式 Markdown 延迟渲染，优先保证输入、滚动和操作响应。
- 稳定 ConversationPane 交互回调，避免旧 turn 无效重渲染。
- 降低流式期间整历史持久化频率，保留终态和人机交互节点持久化。
- 增加长会话渲染工作集与回调稳定性回归测试。

Out of scope:

- 本阶段不修改 SQLite 历史表结构。
- 本阶段不引入第三方动态高度虚拟列表库。
- 不改变发送、停止、审批、Thinking、工具卡和自动跟随的业务语义。

## Impact

- 前端会话渲染、Markdown 展示和历史持久化调度。
- 小会话不出现额外操作；只有超过窗口上限时才出现“显示更早消息”入口。

## Acceptance Criteria

- [ ] 小会话的布局、操作和滚动行为与现状一致。
- [ ] 长会话首次挂载的 turn 数量有上限，完整历史可通过顶部入口逐段展开。
- [ ] 流式输出时 Markdown 更新不阻塞高优先级交互。
- [ ] 旧 turns 不因临时回调引用而重新渲染。
- [ ] 流式 delta 不再每帧调度整历史持久化，终态内容不丢失。
- [ ] 用户离开底部后不被自动拉回，手动到底部行为不回归。

## Verification Commands

- `npm run test`
- `npm run typecheck`
- `npm run build`

## Implementation Record
- 2026-07-16T16:10:59.699Z 完成第一阶段大上下文优化：会话按 60 轮渐进挂载并保留更早历史入口；稳定 turn 操作回调；Markdown 使用 deferred content；Generic Agent delta 不再逐帧调度整历史持久化，持久化防抖调整为 750ms。

- 2026-07-16T16:05:16.402Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T16:11:00.276Z `npm run typecheck && npm run build && git diff --check`: 通过：TypeScript 与 Vite 构建成功，diff 无空白错误；仅既有 Windows 行尾提示和 chunk size 提示。
- 2026-07-16T16:10:59.993Z `node --import tsx --test src/**/*.test.ts`: 通过：509/509

## Completion Summary
- 2026-07-16T16:11:48.189Z 第一阶段完成：会话渐进渲染、稳定交互回调、流式 Markdown 延迟更新、降低整历史持久化频率；前端 509/509 测试、类型检查和生产构建通过，桌面开发版已重启。

## Follow-ups

- 待补充。
