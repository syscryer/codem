# Task: 隐藏 OpenCode DCP 内部消息标识

## Background

OpenCode 的 `@tarquinen/opencode-dcp` 插件会在 assistant 正文末尾附加
`<dcp-message-id>...</dcp-message-id>`，用于插件内部的消息追踪和上下文裁剪。
CodeM 当前按 ACP 文本原样展示，导致内部标识出现在正文、历史和复制内容中。

## Objective

统一过滤 OpenCode DCP 插件附加的 dcp-message-id 标签，避免出现在实时回复、历史和复制内容中

## Scope

In scope:

- 在 CodeM 可见文本归一化层移除回答末尾的 DCP 消息标识。
- 同时覆盖实时增量、SQLite 历史修复和复制所依赖的 timeline 文本。
- 补充完整回答和历史回显的回归测试。

Out of scope:

- 不修改用户的 OpenCode 或 DCP 插件配置。
- 不从 OpenCode 内部会话中删除标识，不影响 DCP 的上下文裁剪机制。
- 不把该标识转换为 Thinking 内容。

## Impact

- `src/lib/conversation.ts`
- `src/lib/conversation.test.ts`

## Acceptance Criteria

- [x] 回答末尾的完整 DCP 消息标识不进入可见正文和历史回显。
- [x] 正文中用于解释或举例的同名标签不会被误删。
- [x] Thinking 折叠和普通回答内容保持现有行为。
- [x] 前端定向测试和类型检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-16T13:27:43.833Z 在可见 assistant 文本归一化层过滤回答末尾的 dcp-message-id；规则只匹配末尾 m+数字标识，保留正文中的标签示例，并覆盖实时事件与历史修复路径。

- 2026-07-16T13:25:18.670Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T13:27:46.525Z `git diff --check`: 通过；仅有工作区既有 LF/CRLF 提示，无空白错误。

- 2026-07-16T13:27:45.615Z `npm run typecheck`: TypeScript 类型检查通过。
- 2026-07-16T13:27:44.733Z `node --import tsx --test src/lib/conversation.test.ts src/lib/agent-run-events.test.ts`: 19/19 通过，覆盖实时 DCP 标识过滤、历史回显过滤、正文标签示例保留及既有 Thinking 行为。

## Completion Summary
- 2026-07-16T13:28:43.628Z CodeM 现已隐藏 OpenCode DCP 插件附加在回答末尾的内部消息标识，同时保留正文中的标签示例；实时事件、历史修复和复制所用 timeline 均使用清理后的文本。

## Follow-ups

- 无。
