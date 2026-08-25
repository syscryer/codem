# Task: 文件预览标签中键关闭

## Background

文件浏览页的预览标签已有悬停关闭按钮，但用户希望使用鼠标中键快速关闭标签。

## Objective

支持在文件浏览页用鼠标中键点击预览标签关闭当前标签。

## Scope

In scope:

- 文件浏览页预览标签响应鼠标中键点击。
- 复用现有 `onCloseTab` 回调和标签切换逻辑。
- 审查页保持现有行为不变。

Out of scope:

- 新增可见关闭按钮、修改审查页或处理问题1。

## Impact

- 前端：`src/components/RightWorkbench.tsx` 的文件预览标签。
- 不新增接口和状态。

## Acceptance Criteria

- [x] 文件浏览页中键点击预览标签会关闭该标签。
- [x] 关闭后沿用现有逻辑选择下一个活动标签。
- [x] 左键切换、右键菜单和悬停关闭行为不变。
- [x] 审查页不启用该中键关闭入口。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workbench-preview.test.ts`

## Implementation Record
- 2026-08-24T10:36:25.056Z 按用户澄清撤回可见关闭按钮，改为文件浏览页预览标签的鼠标中键 onAuxClick 关闭；审查页通过 enableMiddleClickClose=false 保持不变。

- 2026-08-24T10:34:38.000Z Task created by Trellis automation.

## Verification Results
- 2026-08-24T10:36:26.137Z `npm run build`: 通过

- 2026-08-24T10:36:25.767Z `node --import tsx --test src/lib/workbench-preview.test.ts`: 通过（1/1）
- 2026-08-24T10:36:25.417Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-24T10:36:26.525Z 文件浏览页支持鼠标中键点击预览标签关闭；撤回了误加的显式关闭按钮，审查页行为不变。

## Follow-ups

- 问题1仍待后续处理。
