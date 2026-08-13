# Task: 修正工作流首节点落点与尺寸

## Background

空白工作流首次拖入节点后，节点会被 React Flow 延迟执行的初始 `fitView` 重新居中并放大，看起来没有停在鼠标落点；已有节点后继续拖入则不会复现。同时当前节点宽度相对画布偏大。

## Objective

空白画布首次拖入节点时保持鼠标落点稳定，并适当收紧工作流节点尺寸。

## Scope

In scope:

- 空白画布不排队执行初始自动适配，避免首节点出现后视口跳动。
- 已有节点的模板或保存工作流继续在首次打开时自动适配。
- 适当收紧工作流节点宽度、高度和内部间距。

Out of scope:

- 不改变第二个及后续节点的拖入坐标换算。
- 不改变画布缩放、平移、模板布局与数据结构。

## Impact

- 仅影响工作流编辑器首次视口适配和节点视觉尺寸。
- 无后端、持久化和安装包变更。

## Acceptance Criteria

- [x] 空白画布首次拖入节点后不再触发自动居中或缩放。
- [x] 模板及已有工作流首次打开仍自动适配全部节点。
- [x] 后续节点保留现有拖入落点逻辑。
- [x] 节点尺寸更紧凑，文本与连接点布局保持完整。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `git diff --check`

## Implementation Record
- 2026-08-13T02:21:52.233Z 根因是空画布的初始 fitView 在首节点测量后才执行，导致首节点视口跳动；已固定初始适配条件，并将节点宽度由 220px 收紧至 200px，后续拖入坐标逻辑保持不变。

- 2026-08-13T02:20:22.445Z Task created by Trellis automation.
- 2026-08-13 将 React Flow 的初始 `fitView` 固定为组件挂载时是否已有节点，避免空画布在首节点完成测量后延迟适配。
- 2026-08-13 将工作流节点宽度由 220px 收紧至 200px，并同步缩小高度、内边距和文本宽度。

## Verification Results
- 2026-08-13T02:22:03.435Z `npm run typecheck; node --import tsx --test src/lib/workflow-prototype.test.ts; git diff --check`: 全部通过：类型检查、工作流测试 8/8、diff 检查；桌面开发窗口仍响应。

- `npm run typecheck`: passed.
- `node --import tsx --test src/lib/workflow-prototype.test.ts`: passed, 8/8 tests.
- `git diff --check`: passed; only existing CRLF conversion warnings remain.
- Desktop dev process remained responsive after Vite HMR.

## Completion Summary
- 2026-08-13T02:22:25.174Z 修正空白工作流首节点拖入时的 fitView 延迟跳动，收紧节点尺寸，保持后续拖入落点逻辑不变。

空白工作流首节点不再因延迟 `fitView` 被重新居中和放大；已有图仍保留打开时自动适配。节点整体尺寸已收紧，后续拖入落点算法未改动。

## Follow-ups

- 由用户在桌面开发版确认首节点实际落点与新尺寸观感。
