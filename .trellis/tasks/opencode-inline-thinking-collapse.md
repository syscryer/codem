# Task: 折叠 OpenCode 内联思考

## Background

OpenCode 已能通过 ACP `agent_thought_chunk` 输出独立思考事件，但部分模型仍会在 `agent_message_chunk` 正文中返回 `<think>...</think>`。共享会话修复逻辑目前只识别 `<thinking>...</thinking>`，导致 `<think>` 标签及内容被当成普通正文直接展示，无法使用 Claude Code 现有的 Thinking 折叠交互。

## Objective

将 OpenCode 正文流中的 think 标签解析为与 Claude Code 相同的可折叠 Thinking 项

## Scope

In scope:

- 共享内联思考解析同时识别成对的 `<think>` 与 `<thinking>` 标签。
- 标签内内容转换为现有 Thinking item，标签外内容继续作为最终回答 Text item。
- `assistantText` 仅保留最终回答，避免复制、持久化和历史恢复混入内联思考。
- 复用现有 Thinking `<details>`：默认折叠，点击后可展开查看完整内容。
- 补充实时/历史共用的会话修复回归测试。

Out of scope:

- 不删除思考内容，不修改 ACP `agent_thought_chunk` 映射。
- 不为 OpenCode 新增独立 Thinking 组件或独立持久化字段。
- 不解析未闭合标签，避免流式半包期间提前吞掉正文。

## Impact

- Frontend data model：`src/lib/conversation.ts` 的内联思考归一化。
- Frontend rendering：继续复用 `ConversationTurn` 的 Thinking 折叠组件，不新增视觉体系。
- Persistence：沿用现有 `turn.items`，不新增数据库字段。

## Acceptance Criteria

- [x] `<think>思考</think>回答` 被归一化为 Thinking + Text 两个 item。
- [x] 既有 `<thinking>` 兼容行为不回归。
- [x] 完成态默认只显示 Thinking 摘要，点击后可展开完整思考。
- [x] `assistantText` 和复制回复只包含最终回答。
- [x] 未闭合 `<think>` 流式片段保持可见，直到闭合后再归一化。
- [x] 前端定向测试和类型检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-16T13:14:47.161Z 确认截图中的 OpenCode 思考来自正文流的 <think> 标签，而非已展开的 Thinking 组件；共享解析器现同时兼容 think/thinking，完成后进入现有默认折叠 Thinking 项。

- 2026-07-16T13:11:46.096Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T13:18:02.280Z `npm run typecheck；git diff --check；开发版 HMR 与首页检查`: 全部通过：TypeScript 无错误，差异检查无错误，Vite 已热更新且 5173 返回 200
- 2026-07-16T13:18:01.892Z `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`: 通过：16/16；think/thinking 均归一化，未闭合流式片段保留，Thinking details 默认关闭

## Completion Summary
- 2026-07-16T13:18:02.728Z 修复 OpenCode 内联思考展示：正文流中的成对 think/thinking 标签统一转换为现有 Thinking 项，内容保留且完成后默认折叠，最终回答与复制文本不混入思考；定向测试、类型检查和开发版热更新验证通过。

## Follow-ups

- 后续发现其他模型包装标签时，先确认其是否为稳定协议输出，再扩展共享解析器。
