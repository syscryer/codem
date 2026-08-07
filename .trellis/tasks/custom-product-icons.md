# Task: 优化 CodeM 主导航图标

## Background

主导航入口使用通用图标库图标，和 CodeM 的产品气质缺少差异感；同一组入口在窄侧栏中也需要保持一致。

## Objective

将主侧栏和相关入口的通用图标替换为 CodeM 自绘线性图标，提升识别度并保持现有交互不变

## Scope

In scope:

- 新建任务、新建聊天、搜索、Agent Hub、插件、自动化使用统一的自绘 SVG 组件。
- 图标在宽侧栏和窄侧栏复用同一组件。

Out of scope:

- 不修改聊天列表内部状态图标。
- 不调整入口文案、快捷键和点击行为。

## Impact

- 前端主导航视觉与图标渲染。

## Acceptance Criteria

- [x] 六个主导航入口均不再依赖 lucide 图标。
- [x] 图标保持统一线宽、圆角端点和 currentColor 主题适配。
- [x] 类型检查和生产构建通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`

## Implementation Record
- 2026-08-07T06:49:00.348Z 主导航六个入口已统一替换为 CodeMIcon 自绘线性 SVG，保留聊天列表内部图标和所有交互逻辑。

- 2026-08-07T06:44:56.620Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T06:53:57.785Z `npm run build`: pass
- 2026-08-07T06:53:57.120Z `npm run typecheck`: pass

- `npm run typecheck`: pass
- `npm run build`: pass

## Completion Summary
- 2026-08-07T06:53:58.471Z 主导航六个入口已统一使用 CodeMIcon 自绘线性 SVG，交互和聊天列表内部图标保持不变；typecheck 与 production build 均通过。

- 已完成 CodeM 主导航自绘图标首版。

## Follow-ups

- 无。
