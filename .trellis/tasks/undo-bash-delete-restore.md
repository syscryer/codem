# Task: 撤销恢复 Bash 删除文件

## Background

用户测试撤销时发现：本次新增文件被删除、编辑改动被恢复，但 `style.css` 没有恢复。排查 Claude Code session `f5cf41ee-4e66-4b52-a7a0-f0ec80f3adc2` 后确认：本轮对 `style.css` 的删除来自 `Bash(rm D:/ai_proj/test/snake-game/style.css)`，而当前撤销 payload 只覆盖 `Edit` / `Write` / `NotebookEdit` 等结构化文件工具，无法从 Bash 命令本身知道删除前内容。

## Objective

让撤销本次 AI 改动能恢复同一线程中 Bash rm 删除且历史可知内容的文件

## Scope

In scope:

- 在前端撤销 payload 构造阶段识别明确删除单个项目文件的 Bash 命令。
- 从当前线程中该 turn 之前的结构化文件工具历史里寻找最近一次可信文件内容，构造 `restore-file` 操作。
- 保持后端原子撤销语义不变，`restore-file` 继续由后端统一执行。
- 补充测试覆盖 Bash `rm` 删除历史已知文件可以恢复。

Out of scope:

- 不尝试恢复没有历史内容的 Bash 删除文件。
- 不解析复杂 shell 脚本、通配符、目录删除、管道、变量展开或递归删除。
- 不把 Bash 快照做成持久化文件系统级审计；后续可单独实现执行前快照。

## Impact

- 影响聊天卡片“撤销本次 AI 改动”生成的 undo payload。
- 对非 Bash 删除、无法识别路径或无法找到历史内容的场景保持现状。

## Acceptance Criteria

- [ ] 当前 turn 中 `Bash(rm <项目内文件>)` 删除的文件，如果之前 turn 有已知内容，撤销 payload 会包含 `restore-file`。
- [ ] 无历史内容、复杂命令或目录删除不会生成不可靠恢复操作。
- [ ] 既有 Edit/Write 撤销行为保持不变。
- [ ] 相关前后端测试与 TypeScript 类型检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation-changed-files.test.ts`
- `node --import tsx --test server/lib/workspace-store-undo.test.ts`
- `npm run typecheck`

## Implementation Record

- 2026-06-26T08:35:59.402Z 已完成 Bash 删除文件恢复链路：前端撤销 payload 会基于当前 turn 之前的结构化文件历史识别简单 Bash rm/del/erase 单文件删除并生成 restore-file；后端补充混合撤销回归测试，覆盖被 shell 删除文件恢复、新建文件删除、编辑文件回退一次性成功。
- 2026-06-26T08:28:39.670Z 已补充红灯测试：当前 turn 的 Bash rm 删除 style.css 时，即使之前 turn 有 Write 内容，现有撤销 payload 仍为空，确认 Bash 删除恢复缺口。

- 2026-06-26T08:27:34.394Z Task created by Trellis automation.

## Verification Results

- 2026-06-26T08:36:32.323Z `git diff --check`: 通过：无空白错误；仅有 Windows 工作区 LF 将被 Git 触碰时转换为 CRLF 的提示。
- 2026-06-26T08:36:25.077Z `npm run typecheck`: 通过：tsc -b 无类型错误。

- 2026-06-26T08:36:17.503Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 通过：9 个后端撤销测试全部通过，新增覆盖 restore-file/delete-file/replace-snippet 混合撤销，确认 shell 删除文件可恢复且撤销仍保持原子应用。
- 2026-06-26T08:36:09.744Z `node --import tsx --test src/lib/conversation-changed-files.test.ts`: 通过：8 个前端撤销 payload 测试全部通过，覆盖绝对路径归一化、失败工具过滤、replace_all 保留、简单 Bash rm 历史内容恢复与无历史内容忽略。

## Completion Summary
- 2026-06-26T08:36:40.756Z 完成撤销恢复 Bash 删除文件：前端 now 会把同线程历史中可知内容的简单 Bash rm/del/erase 单文件删除转为 restore-file；后端新增混合撤销测试确认删除文件恢复、新建文件删除、编辑回退可一次性原子完成。复杂 shell、无历史内容、目录/通配符删除仍按设计不生成恢复。

## Follow-ups

- 后续可以在 Claude tool_use 输入完整后、tool_result 返回前做真实执行前快照，用于覆盖没有历史内容或被 Bash 覆盖写入的文件。
