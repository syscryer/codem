# Task: 撤销 AI 改动改为原子执行

## Background

当前“撤销本次 AI 改动”后端会按文件逐个执行撤销。若前面的文件已经写盘，后续文件因为内容不匹配、重复片段或文件状态异常而失败，工作区可能留下“部分文件已撤销、部分文件未撤销”的中间状态。用户期望撤销行为明确为要么整体失败、要么整体成功。

## Objective

让撤销本次 AI 改动要么全部成功落盘，要么失败且不改动工作区

## Scope

In scope:

- 将后端撤销执行改为先在内存中计算并校验全部文件结果。
- 任一文件或操作校验失败时，不写入任何文件。
- 全部校验通过后再统一落盘，并在写盘失败时尽量恢复已触碰文件。
- 补充回归测试覆盖多文件撤销中途失败不能留下半撤销状态。

Out of scope:

- 不调整前端按钮样式或文案。
- 不改变撤销 payload 的结构。
- 不放宽项目内相对路径安全校验。

## Impact

- 影响 `undoProjectAiTurnChanges` 的后端执行语义。
- 保持前端撤销请求和返回结构兼容。
- 保持既有 `replace-snippet`、`delete-file`、`restore-file` 语义，只调整写盘时机和失败一致性。

## Acceptance Criteria

- [x] 多文件撤销时，任一文件无法安全撤销，不会修改其他文件。
- [x] 多文件撤销全部通过时，返回 restored/deleted 结果保持兼容。
- [x] 写盘阶段出现异常时，已写入/删除的文件会尽量回滚到撤销前状态。
- [x] 既有撤销回归测试继续通过。
- [x] TypeScript 类型检查通过。

## Verification Commands

- `node --import tsx --test server/lib/workspace-store-undo.test.ts`
- `node --import tsx --test src/lib/conversation-changed-files.test.ts`
- `npm run typecheck`

## Implementation Record

- 2026-06-26T07:53:05.648Z 已将后端撤销执行改为两阶段：先在内存中计划并校验所有文件结果，全部通过后再统一写盘；写盘阶段异常会按快照反向恢复已触碰文件。
- 2026-06-26T07:49:25.463Z 已补充原子撤销红灯测试：多文件撤销中第二个文件失败时，现有实现会提前修改第一个文件，确认存在半撤销风险。

- 2026-06-26T07:47:50.010Z Task created by Trellis automation.

## Verification Results
- 2026-06-26T07:54:00.259Z `git diff --check`: 通过：退出码 0，仅有 Windows CRLF 工作区提示，无 diff 格式错误。

- 2026-06-26T07:54:00.212Z `node --import tsx --test src/lib/conversation-changed-files.test.ts`: 通过：5 个前端撤销构造测试全部通过，绝对路径归一化场景保持正常。
- 2026-06-26T07:53:50.642Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 通过：4 个后端撤销测试全部通过，覆盖正常撤销、内容不匹配失败、校验失败不写盘、写盘失败回滚。

## Completion Summary
- 2026-06-26T07:54:30.806Z 完成撤销 AI 改动原子执行：后端先计划并校验所有文件，全部通过后统一落盘；校验失败不会写盘，写盘失败会按快照尽量回滚。补充多文件校验失败和写盘失败回滚测试，相关测试、typecheck、diff check 均通过。

## Follow-ups

- 后续如要进一步降低撤销失败率，可单独设计删除片段撤销和换行风格保留策略；本任务只保证当前撤销操作的原子执行语义。
