
# Task: 撤销新建文件允许行尾空白差异

## Background

用户在撤销 Claude Code 会话 `f5cf41ee-4e66-4b52-a7a0-f0ec80f3adc2` 创建的 `snake-game/index.html` 时，后端报“已经不是上次 AI 修改后的内容”。排查 CodeM Dev 本地库和当前文件后确认：该文件与 `Write.content` 的功能内容一致，但空白行上的缩进空格被去掉，导致整文件精确匹配失败。

## Objective

修复 AI 新建文件仅行尾空白变化时无法撤销的问题，同时保持内容真实变化时失败

## Scope

In scope:

- 调整 `delete-file` 撤销校验：保持精确匹配优先，允许仅行尾空白不同的整文件内容视为同一 AI 新建文件。
- 补充回归测试覆盖空白行缩进被清理后仍可撤销。
- 保持正文内容、行结构或非行尾空白发生变化时仍失败。

Out of scope:

- 不放宽为忽略全部空白。
- 不改变编辑片段 `replace-snippet` 的匹配策略。
- 不改变撤销 payload 结构和 UI 文案。

## Impact

- 影响后端 `undoProjectAiTurnChanges` 中 `delete-file` 操作的整文件安全比较。
- 降低编辑器/格式化器清理行尾空白后，新建文件无法撤销的误失败率。

## Acceptance Criteria

- [x] 新建文件当前内容仅行尾空白与 AI 写入内容不同，可以撤销删除。
- [x] 新建文件正文内容发生变化时，仍拒绝撤销。
- [x] 既有原子撤销测试继续通过。
- [x] TypeScript 类型检查通过。

## Verification Commands

- `node --import tsx --test server/lib/workspace-store-undo.test.ts`
- `node --import tsx --test src/lib/conversation-changed-files.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record

- 2026-06-26T08:01:04.000Z Task created by Trellis automation.
- 2026-06-26T08:03:00Z 已用真实会话定位失败原因：`snake-game/index.html` 与 `Write.content` 仅存在空白行行尾缩进差异，`delete-file` 精确匹配导致误判为文件已变化。
- 2026-06-26T08:03:45Z 已实现 `delete-file` 整文件安全比较：保留精确匹配优先，额外允许仅行尾空白差异；正文内容变化仍会拒绝撤销。
- 2026-06-26T08:05:00Z 修复 Trellis verify 并行写入导致的任务记录正文丢失，后续写入类 Trellis 命令改为顺序执行。

## Verification Results

- 2026-06-26T08:03:20Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 红灯：仅行尾空白差异场景在旧逻辑下失败，复现用户问题。
- 2026-06-26T08:03:55Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 通过：6 个后端撤销测试全部通过，新增覆盖仅行尾空白差异可删除、正文变化仍拒绝。
- 2026-06-26T08:04:09.456Z `node --import tsx --test src/lib/conversation-changed-files.test.ts`: 通过：5 个前端撤销构造测试全部通过。
- 2026-06-26T08:04:09.448Z `npm run typecheck`: 通过：`tsc -b` 退出码 0。
- 2026-06-26T08:04:09.610Z `git diff --check`: 通过：退出码 0，仅有 Windows CRLF 工作区提示，无 diff 格式错误。

## Completion Summary
- 2026-06-26T08:06:48.825Z 完成撤销新建文件行尾空白容忍：真实会话中 index.html 仅空白行缩进被清理导致 delete-file 精确匹配失败；现在整文件删除校验在精确匹配外允许仅行尾空白差异，正文变化仍拒绝。相关后端/前端测试、typecheck、diff check 均通过。

## Follow-ups

- 如后续要让编辑片段也支持更复杂的格式化差异，需要单独设计带上下文锚点的撤销模型，避免误替换。
