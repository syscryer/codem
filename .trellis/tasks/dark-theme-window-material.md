# Task: 限制深色主题窗口材质

## Background

Windows 的 Mica、Acrylic 和 Mica Alt 在深色主题下会让根材质、侧栏和内容区域的明暗关系显得不自然。当前外观设置仍允许深色主题继续选择这些材质，标题栏“窗口”菜单也会暴露相同选项。

## Objective

深色主题下强制使用默认窗口材质并禁用 Mica 等选项

## Scope

In scope:

- 显式深色主题强制使用“默认”窗口材质。
- “跟随系统”且操作系统处于深色时执行相同限制，并响应系统主题实时变化。
- 深色主题下外观设置和标题栏窗口菜单只暴露“默认”，不能选择 Mica、Acrylic 或 Mica Alt。
- 保留用户在浅色主题下已保存的材质偏好，切回浅色后恢复。

Out of scope:

- 不改变浅色主题下 Windows 可用材质列表。
- 不修改 Tauri/Rust 的原生窗口材质接口。
- 不删除现有材质样式和旧设置兼容逻辑。

## Impact

- Frontend：主题派生状态、有效材质、外观设置和标题栏窗口菜单。
- Backend / persistence：无结构变更，已保存材质偏好继续保留。

## Acceptance Criteria

- [x] 显式深色以及系统深色模式下，有效窗口材质均为“默认”。
- [x] 深色时设置页和标题栏窗口菜单不提供 Mica、Acrylic、Mica Alt。
- [x] 切回浅色后恢复用户此前选择的材质，不覆盖持久化偏好。
- [x] 系统主题改变时立即同步有效材质和可选项。
- [x] macOS、Web 和不支持多材质的平台行为不回归。

## Verification Commands

- `node --import tsx --test src/lib/window-material.test.ts`
- `npm run typecheck`
- `node --import tsx --test src/**/*.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-17T16:18:09.351Z 实现深色主题窗口材质限制：显式深色及系统深色均强制有效材质为默认；设置页和标题栏菜单只暴露默认；浅色材质偏好不被覆盖，系统主题变化实时同步。

- 2026-07-17T16:15:30.742Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T16:25:04.811Z `git diff --check`: 通过，仅有既有 LF/CRLF 提示

- 2026-07-17T16:25:04.109Z `npm run build`: 生产构建通过
- 2026-07-17T16:25:03.316Z `npm run typecheck`: 通过

- 2026-07-17T16:25:02.513Z `node --import tsx --test src/**/*.test.ts`: 全量前端测试通过
- 2026-07-17T16:25:01.798Z `node --import tsx --test src/lib/window-material.test.ts`: 29/29 通过

## Completion Summary
- 2026-07-17T16:25:05.505Z 深色主题及系统深色模式下强制使用默认窗口材质，并隐藏 Mica、Acrylic、Mica Alt 选项；浅色偏好保持不变，系统主题变化实时生效，全部验证通过。

## Follow-ups

- 无。
