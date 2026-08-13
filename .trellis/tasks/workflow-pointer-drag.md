# Task: 工作流节点指针拖拽

## Background

原生 HTML5 `draggable` 在桌面 WebView 中表现为禁止拖放图标，无法将节点真正放入画布。

## Objective

改用桌面 WebView 可靠的指针拖拽，将节点库条目拖到画布落点创建节点，同时保留点击新增。

## Scope

In scope:

- 节点库使用 Pointer Events 识别拖拽手势，避免依赖原生 HTML5 drag-and-drop。
- 松开时按鼠标位置判断画布范围，并创建对应节点。
- 点击节点库条目仍按原行为新增节点。

Out of scope:

- 不改变节点图、连线或执行逻辑，不新增第三方拖拽依赖。

## Impact

- `src/components/WorkflowPrototype.tsx`

## Acceptance Criteria

- [x] 拖动节点库条目不会显示系统禁止拖放图标。
- [x] 在画布内松开时按落点创建节点。
- [x] 单击节点库条目仍可新增节点。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run build`

## Implementation Record
- 2026-08-12T11:30:14.807Z 原生 HTML5 draggable 在桌面 WebView 中被拒绝，已改为 Pointer Events + Pointer Capture，在画布内松开时按落点创建节点。

- 2026-08-12T11:28:01.815Z Task created by Trellis automation.
- 使用 Pointer Capture 维持跨画布的移动和松开事件，移除原生 `draggable` 依赖。

## Verification Results
- 2026-08-12T11:30:14.789Z `npm run typecheck && node --import tsx --test src/lib/workflow-prototype.test.ts && npm run build`: 类型检查通过，工作流测试 8/8 通过，生产构建通过

- `npm run typecheck`: 通过
- `node --import tsx --test src/lib/workflow-prototype.test.ts`: 8/8 通过
- `npm run build`: 通过

## Completion Summary
- 2026-08-12T11:30:20.985Z 已将节点库从桌面 WebView 不兼容的原生 HTML5 拖放改为 Pointer Events；拖到画布内松开即按落点创建节点，单击新增保持可用。

- 2026-08-12：节点库改为指针拖拽，兼容桌面 WebView；画布内落点创建节点，点击新增保持可用。

## Follow-ups

- 待补充。
