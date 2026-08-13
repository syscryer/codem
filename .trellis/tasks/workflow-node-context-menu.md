# Task: 工作流节点右键菜单

## Background

工作流画布已支持节点选择、框选和键盘删除，但鼠标用户缺少贴近节点的快捷操作入口。为保持编辑体验轻量，需要复用现有菜单体系提供节点右键操作。

## Objective

为工作流画布节点增加右键菜单，支持复制和删除，并保持关联连线与选择状态一致。

## Scope

In scope:

- 右键节点时选中节点，并在鼠标位置打开主题化菜单。
- 支持复制节点，保留节点配置并偏移副本位置，不复制执行路径。
- 支持删除节点，同时删除所有关联执行路径并清理选择状态。
- 点击外部、按 Esc、窗口尺寸变化或继续操作画布时关闭菜单。

Out of scope:

- 不增加重命名、禁用、分组等高级节点操作。
- 不改变工作流运行协议、持久化格式和模板定义。

## Impact

- 前端工作流编辑器交互与菜单样式。
- 无后端、数据库结构或安装包变更。

## Acceptance Criteria

- [x] 右键任意节点可在指针位置看到节点菜单，浏览器默认菜单不会出现。
- [x] 复制节点后生成独立 ID、保留配置、名称标记为副本并偏移显示，原节点连线不被复制。
- [x] 删除节点后节点及其全部关联连线一并移除，选择态与菜单状态清理。
- [x] 菜单可通过点击外部、Esc、窗口尺寸变化及画布后续操作关闭。
- [x] 菜单复用现有 PopoverPortal、主题菜单样式和危险操作视觉。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-13T02:10:43.848Z 工作流节点右键菜单已实现：支持复制、删除，删除会同步清理关联连线；菜单复用现有 PopoverPortal 和主题样式。

- 2026-08-13T01:48:42.877Z Task created by Trellis automation.
- 2026-08-13 Added node context-menu state, lifecycle handling, duplicate/delete actions and themed menu presentation in `WorkflowPrototype`.
- 2026-08-13 Node deletion reuses the editor's node removal path so related edges, selection and dirty state remain consistent.

## Verification Results
- 2026-08-13T02:10:55.559Z `npm run typecheck; node --import tsx --test src/lib/workflow-prototype.test.ts; npm run build; git diff --check`: 全部通过：typecheck 通过，工作流测试 8/8，通过生产构建和 diff 检查。交互验收按用户要求由用户自行完成。

- `npm run typecheck`: passed.
- `node --import tsx --test src/lib/workflow-prototype.test.ts`: passed, 8/8 tests.
- `npm run build`: passed; only existing Vite chunk-size and mixed dynamic/static import warnings remain.
- `git diff --check`: passed; only existing CRLF conversion warnings remain.
- Interactive acceptance is left to the user as requested.

## Completion Summary
- 2026-08-13T02:11:08.165Z 完成工作流节点右键菜单：支持复制节点和删除节点，删除同步清理关联连线；菜单具备外部点击、Esc 和画布操作关闭行为。

工作流节点现可通过右键菜单复制或删除。复制会创建无连线的独立副本；删除会同步清理关联连线与编辑状态。菜单沿用 CodeM 现有弹层和主题样式。

## Follow-ups

- 无。本轮不扩展更多节点菜单命令。
