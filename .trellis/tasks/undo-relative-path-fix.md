## Background

聊天卡片里的“撤销本次 AI 改动”在部分会话里会失败，提示“文件路径必须是项目内的相对路径”。
Claude 工具在真实运行中可能返回项目内绝对路径，前端撤销 payload 直接沿用该值，后端出于安全约束拒绝绝对路径。

## Objective

定位并修复撤销 AI 改动时绝对路径被传入导致后端拒绝的问题。

## Scope

In scope:

- 定位撤销链路中路径从哪里进入 payload。
- 在前端撤销数据构造阶段把项目内绝对路径归一化为项目相对路径。
- 为该场景补回归测试，并确认后端既有撤销语义不受影响。

Out of scope:

- 不调整后端相对路径安全校验规则。
- 不顺带改动 changed files 卡片的展示文案或其他路径展示逻辑。

## Impact

- 影响聊天卡片“撤销本次 AI 改动”按钮的请求数据构造。
- 保持后端 undo 安全边界不变，仅修正前端传参格式。

## Acceptance Criteria

- [x] 工具返回项目内绝对路径时，前端撤销 payload 会转换为项目相对路径。
- [x] 既有相对路径撤销场景保持不变。
- [x] 后端 undo 回归测试继续通过。
- [x] TypeScript 类型检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation-changed-files.test.ts`
- `node --import tsx --test server/lib/workspace-store-undo.test.ts`
- `npm run typecheck`

## Implementation Record

- 2026-06-26T07:36:02.145Z Task created by Trellis automation.
- 2026-06-26T07:40:51.858Z 已确认根因：`buildConversationUndoChanges` 直接使用 `tool.inputText.file_path`，Claude 实际可能返回项目内绝对路径，后端 undo 仅接受相对路径，导致撤销请求被拒绝。已补充失败测试覆盖该场景。
- 2026-06-26T07:44:00Z 在前端撤销数据构造阶段引入项目根路径归一化，并在 `ConversationTurn` 调用处传入当前项目路径/线程工作目录。

## Verification Results
- 2026-06-26T07:41:55.338Z `git diff --check`: 通过：退出码 0，仅有现存文件的 CRLF 提示。

- 2026-06-26T07:44:23.247Z `node --import tsx --test src/lib/conversation-changed-files.test.ts`: 通过：新增绝对路径撤销用例在内的 5 个测试全部通过。
- 2026-06-26T07:44:24.386Z `node --import tsx --test server/lib/workspace-store-undo.test.ts`: 通过：后端撤销恢复与安全失败两条用例保持通过。
- 2026-06-26T07:44:25.482Z `npm run typecheck`: 通过：`tsc -b` 退出码 0。

## Completion Summary
- 2026-06-26T07:41:55.382Z 修复撤销 AI 改动失败：前端现在会把项目内绝对路径归一化为相对路径后再发给 undo 接口；新增回归测试覆盖绝对路径场景，相关测试与 typecheck 均通过。

- 前端撤销链路现在会优先把项目内绝对路径压成相对路径，再发给后端 undo 接口。
- 已补测试覆盖 Windows 绝对路径输入，避免回归。

## Follow-ups

- 如后续要统一聊天卡片里的路径展示，可复用同类“项目内绝对路径 -> 相对路径”逻辑收口 changed files / tool detail 展示。
