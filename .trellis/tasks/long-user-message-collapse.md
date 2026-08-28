# Task: 长用户消息折叠

## Background

用户发送很长的需求或上下文时，完整用户消息会占据大量对话高度，难以快速定位后续 Agent 输出。参考 Codex 的长消息展示方式，将超高文本收纳为固定高度气泡，并保留显式展开入口。

## Objective

用户消息过长时按参考图折叠显示，并支持显示更多和收起，不影响附件、消息操作及原始内容

## Scope

In scope:

- 仅折叠已发送消息中的用户文本。
- 根据实际渲染高度判断是否需要折叠，适配中文、代码、换行、字体和窗口宽度变化。
- 折叠态提供底部渐隐与“显示更多”，展开态提供“收起”。
- 附件、复制、编辑、删除和消息时间保持在折叠区外。

Out of scope:

- 不修改 Composer 输入框高度或输入行为。
- 不改变消息持久化、发送协议、附件模型和 Agent 收到的原始内容。
- 不持久化单条消息的展开状态。

## Impact

- Frontend: `src/components/ConversationTurn.tsx`、`src/styles.css` 及最小回归测试。
- Backend / persistence: 无影响。

## Acceptance Criteria

- [x] 短用户消息保持当前样式且不显示展开控件。
- [x] 超过约 360px 折叠高度的用户文本默认收起，底部有渐隐和“显示更多”。
- [x] 点击“显示更多”展示完整原文，点击“收起”恢复折叠。
- [x] 展开按钮支持键盘操作并暴露 `aria-expanded`。
- [x] 附件和消息操作区不被遮挡，复制与编辑仍使用完整原文。
- [x] 窗口或字体变化后重新判断是否溢出，明暗主题均可读。

## Verification Commands

- `node --import tsx --test src/components/ConversationTurn.user-message-collapse.test.ts`
- `npm run typecheck`
- 浏览器实际检查短消息、长消息、展开/收起和窄窗口布局。

## Implementation Record
- 2026-08-28T06:00:34.357Z 在 ConversationTurn 中加入基于实际 scrollHeight 的长用户消息折叠；折叠高度 360px，底部渐隐并提供显示更多/收起；附件和消息操作保持外置，展开状态不持久化。

- 2026-08-28T05:57:47.640Z Task created by Trellis automation.

## Verification Results
- 2026-08-28T06:25:32.740Z `Playwright actual browser validation`: 360px 超长消息折叠、显示更多/收起、短消息不折叠、明暗主题、消息操作区外置均已实际验证

- 2026-08-28T06:25:31.892Z `npm run typecheck && npm run build && git diff --check`: TypeScript、Vite production build 和 whitespace 检查通过；仅有既有 chunk size warning
- 2026-08-28T06:25:30.998Z `node --import tsx --test src/components/ConversationTurn.user-message-collapse.test.ts src/components/ConversationStreaming.render-perf.test.ts src/components/ConversationPane.render-perf.test.ts`: 10 tests passed

## Completion Summary
- 2026-08-28T06:25:42.220Z 完成长用户消息折叠：实际高度超过 360px 时显示参考图风格的渐隐和显示更多，支持收起；附件及消息操作不受影响，并通过组件回归、类型检查、生产构建和 Playwright 明暗主题验证。

## Follow-ups

- 待补充。
