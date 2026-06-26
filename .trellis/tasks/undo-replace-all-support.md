# Task: 撤销支持 replace_all 编辑

## Background

用户继续测试撤销时，截图显示 `snake-game/game.js` 报“存在重复片段”。排查 Claude Code session `f5cf41ee-4e66-4b52-a7a0-f0ec80f3adc2` 的后续 turn 后确认：AI 使用 `Edit` 工具执行了 `replace_all: true`，把两处 `this.snakeLength = 3;` 改成 `this.snakeLength = 5;`。当前撤销 payload 没有携带 `replace_all` 语义，后端仍按单处替换处理，因此看到重复片段后拒绝撤销。

## Objective

让 AI Edit 工具 replace_all=true 的多处替换可以安全撤销，同时过滤失败工具调用

## Scope

In scope:

- 前端撤销构造跳过失败的文件修改工具，避免失败工具污染撤销 payload。
- 前端撤销 payload 保留 `replace_all: true` 语义。
- 后端撤销对 `replace_all: true` 执行多处反向替换。
- 补充回归测试覆盖失败工具过滤、replace_all 多处撤销和非 replace_all 重复片段仍失败。

Out of scope:

- 不改变普通单处 `Edit` 的重复片段保护。
- 不引入基于 Git diff 的整文件回滚模型。
- 不调整撤销按钮文案或弹窗交互。

## Impact

- 影响聊天卡片撤销 payload 的构造和后端 `replace-snippet` 撤销语义。
- 保持默认安全策略不变：只有 `replace_all: true` 才允许多处替换。

## Acceptance Criteria

- [x] 失败状态的 Edit/Write/NotebookEdit 不会进入撤销 payload。
- [x] `replace_all: true` 的 Edit 会在撤销时把所有 `afterText` 反向替换为 `beforeText`。
- [x] 普通 Edit 遇到重复片段仍拒绝撤销。
- [x] 既有撤销和路径归一化测试继续通过。
- [x] TypeScript 类型检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation-changed-files.test.ts`
- `node --import tsx --test server/lib/workspace-store-undo.test.ts`
- `npm run typecheck`

## Implementation Record

- 2026-06-26T08:14:30.233Z 已实现 replace_all 撤销支持：前端只保留成功工具并把 replace_all=true 转为 replaceAll；后端仅在 replaceAll=true 时允许多处反向替换，普通编辑仍保留重复片段保护。
- 2026-06-26T08:12:27.000Z 已补充红灯测试：前端撤销构造会把失败 Edit 加入 payload 且丢失 replace_all；后端对 replaceAll 编辑仍按单处替换处理，遇到重复片段失败。

- 2026-06-26T08:10:28.843Z Task created by Trellis automation.

## Verification Results
- 2026-06-26T08:15:18.208Z `git diff --check`: 通过：退出码 0，仅有 Windows CRLF 工作区提示，无 diff 格式错误。

- 2026-06-26T08:15:07.015Z `npm run typecheck`: 通过：tsc -b 退出码 0。
- 2026-06-26T08:14:57.463Z `临时目录复现 session f5cf41ee game.js 撤销`: 通过：复制真实 game.js 到临时项目后，按真实成功 Edit 序列撤销，gridSize/tileCount、两处 snakeLength、score 均恢复。

- 2026-06-26T08:14:47.890Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 通过：8 个后端撤销测试全部通过，覆盖 replaceAll 多处撤销与普通重复片段拒绝。
- 2026-06-26T08:14:38.386Z `node --import tsx --test src/lib/conversation-changed-files.test.ts`: 通过：6 个前端撤销构造测试全部通过，覆盖失败工具过滤与 replace_all 字段保留。

## Completion Summary
- 2026-06-26T08:15:55.627Z 完成撤销 replace_all 支持：前端撤销 payload 过滤失败工具并保留 replace_all=true；后端仅对 replaceAll 操作执行所有匹配的反向替换，普通编辑重复片段仍拒绝。已用真实 game.js 临时复现通过，相关测试和 typecheck 通过。

## Follow-ups

- 如后续要支持更复杂的编辑工具语义，应优先扩展结构化 undo operation，而不是在后端猜测重复片段应替换多少处。
