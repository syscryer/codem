# Task: 工作流节点库拖拽

## Background

节点库已显示“拖入画布”，但桌面 WebView 拖放需要兼容标准数据类型并确保 React Flow 内部画布接收 drop 事件。

## Objective

让节点库中的节点可以直接拖拽到工作流画布，并保留单击新增。

## Scope

In scope:

- 节点库拖拽同时写入自定义 MIME 与 `text/plain`。
- 画布按鼠标落点创建对应节点，并提供拖放状态反馈。
- 保留单击节点库条目新增节点。

Out of scope:

- 不改变节点连线、配置与执行规则，不新增拖拽依赖。

## Impact

- `src/components/WorkflowPrototype.tsx`

## Acceptance Criteria

- [x] 从节点库拖入画布，可在落点创建对应节点。
- [x] 单击节点库条目仍可新增节点。
- [x] 新节点 ID 不含 Mock 遗留前缀。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run build`

## Implementation Record
- 2026-08-12T11:16:38.711Z 节点库拖拽改为兼容自定义 MIME 与 text/plain，并由 React Flow 画布按真实屏幕落点创建节点；保留单击新增并移除 mock 节点 ID。

- 2026-08-12T11:13:28.826Z Task created by Trellis automation.

## Verification Results
- 2026-08-12T11:17:45.860Z `npm run typecheck && node --import tsx --test src/lib/workflow-prototype.test.ts && npm run build`: 类型检查通过，工作流测试 8/8 通过，生产构建通过

- `npm run typecheck`: 通过
- `node --import tsx --test src/lib/workflow-prototype.test.ts`: 8/8 通过
- `npm run build`: 通过

## Completion Summary
- 2026-08-12T11:17:51.668Z 节点库已支持桌面 WebView 下直接拖拽到 React Flow 画布；兼容标准拖放数据，按真实落点创建节点，并保留单击新增。

- 2026-08-12：节点库支持桌面端拖拽到画布，按实际落点创建节点；保留单击新增。

## Follow-ups

- 待补充。
