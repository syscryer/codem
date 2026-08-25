# Task: Markdown 预览刷新

## Background

文件浏览页的右侧预览会复用已缓存的 `previewContentByKey`。文件在外部或终端被修改后，再次点击同一文件不会触发重新读取，因此 Markdown 预览可能继续显示旧内容。

## Objective

为文件浏览页右侧预览增加当前标签刷新，并重新读取磁盘内容。

## Scope

In scope:

- 在文件浏览页右侧预览标题栏提供“刷新预览”按钮。
- 刷新只针对当前普通文件预览标签，绕过已有内容缓存并重新请求文件内容。
- 审查页的 Git Diff、会话卡片预览不显示该按钮，也不改变现有行为。

Out of scope:

- 审查页刷新交互和问题1。

## Impact

- 前端：`src/components/RightWorkbench.tsx` 的文件预览加载和标题栏操作。
- 后端接口和缓存协议不变，继续使用现有文件预览请求。

## Acceptance Criteria

- [x] 文件浏览页打开普通文件后，标题栏显示刷新图标按钮。
- [x] 点击刷新后当前预览进入读取状态，并显示磁盘上的最新内容。
- [x] 切换其他预览标签、进入审查页或打开 Diff 时不受影响。
- [x] 刷新按钮具备标题、ARIA 标签和加载禁用状态。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/workbench-preview.test.ts`

## Implementation Record
- 2026-08-24T10:08:51.843Z 问题2已修复：文件浏览页右侧预览标题栏新增刷新按钮；仅文件页传入回调，审查页不显示；刷新通过 previewReloadKey 绕过当前标签缓存并重新读取磁盘。

- 2026-08-24T10:03:52.410Z Task created by Trellis automation.
- 2026-08-24T10:08:00.000Z 在文件浏览页预览标题栏增加刷新按钮；通过 `previewReloadKey` 让当前标签绕过缓存并重新调用现有文件预览接口，审查页不传入刷新回调。

## Verification Results
- 2026-08-24T10:09:09.158Z `npm run build`: 通过

- 2026-08-24T10:09:08.809Z `node --import tsx --test src/lib/workbench-preview.test.ts`: 通过（1/1）
- 2026-08-24T10:09:08.443Z `npm run typecheck`: 通过

- `npm run typecheck`：通过。
- `node --import tsx --test src/lib/workbench-preview.test.ts`：通过（1/1）。

## Completion Summary
- 2026-08-24T10:09:38.077Z 问题2已完成：文件浏览页当前预览可手动刷新并重新读取磁盘内容；按钮仅出现在文件页，审查页和问题1保持不变。

- 文件浏览页已支持当前预览标签手动刷新；问题1未处理。

## Follow-ups

- 继续定位并处理问题1。
