# Task: 统一深色主题视觉适配

## Background

macOS 桌面端在应用内显式选择深色主题后，原生 `NSVisualEffectView` 仍可能按系统浅色外观渲染，导致侧栏和标题栏保留浅灰毛玻璃；设置页与工作区同时存在少量写死的浅色背景和文字色，进一步造成白底控件、低对比度标题和禁用输入框。Windows 当前表现正常，本次修复必须保持现有布局、交互与跨平台安装流程。

## Objective

修复 macOS 深色主题下侧栏、标题栏、工作区控件和设置页的浅色残留与低对比度，同时保持现有交互和窗口材质行为

## Scope

In scope:

- 仅在 macOS Tauri 运行时同步应用主题到原生窗口外观；`system` 模式继续跟随系统。
- 调整 macOS 显式深色与系统深色下的根材质、侧栏 tint 和边界色，确保文本对比度，同时保留毛玻璃观感。
- 让顶部常用按钮、设置页标题、分组、行、下拉、输入框、按钮、文本域和禁用态复用现有主题变量。
- 增加针对原生主题映射、macOS 暗色材质和关键控件主题化的回归测试。

Out of scope:

- 不改页面布局、控件尺寸、交互路径、窗口拖拽区域和功能行为。
- 不改 Windows 窗口材质、Tauri Rust 窗口初始化或 Agent 安装/检测流程。
- 不重新设计主题配色或增加新主题。

## Impact

- Frontend: `src/App.tsx`、`src/lib/window-material.ts`、`src/styles.css` 及对应测试。
- Desktop runtime: 仅 macOS 调用 Tauri `setTheme`，Web 与 Windows 保持现状。
- Compatibility: Tauri 调用失败时静默保留 CSS 主题，不阻断应用启动或主题切换。

## Acceptance Criteria

- [x] macOS 显式深色主题下，聊天侧栏、设置侧栏与标题栏均呈深色材质，文字清晰可读。
- [x] 设置页默认权限下拉、操作按钮、字体控件、文本域及禁用态不再残留白底或浅色文字。
- [x] 顶部“打开工具”等常用控件随深浅主题切换，hover、禁用和菜单交互保持不变。
- [x] `system` 模式继续跟随操作系统；显式 light/dark 能同步 macOS 原生窗口外观。
- [x] Windows 材质选择与 Agent 安装相关代码无行为变更。
- [x] 定向测试、类型检查和前端构建通过，并在 macOS 桌面开发模式实际切换深浅主题验收。

## Verification Commands

- `node --import tsx --test src/lib/window-material.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `npm run desktop:dev` 后使用桌面界面检查工作区、基础设置、外观、使用情况和主题切换。

## Implementation Record

- 2026-07-17T15:15:30.836Z 已实现 macOS-only 原生窗口主题同步：light/dark 映射到 Tauri setTheme，system 映射为 null；加深 macOS 深色与系统深色材质 tint，并将顶栏、设置标题、下拉、输入、按钮、文本域和禁用字体控件接入统一主题变量。Windows 材质与 Agent 安装代码未修改。
- 2026-07-17T14:37:40.293Z 已确认问题由 macOS 原生窗口外观未随应用显式主题切换，以及设置控件残留硬编码浅色共同造成；修复限定为 macOS-only 原生主题同步和现有主题变量接管，不修改 Windows 材质、交互布局或 Agent 安装链路。

- 2026-07-17T14:29:58.470Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T15:16:05.916Z `定向测试 26/26；全量前端测试 541/541；typecheck；build；diff check；macOS release 深浅主题实机检查`: pass：工作区、基础设置、外观、使用情况、项目下拉均通过，已恢复深色；release 空闲约 0.0% CPU、0.5% 内存、RSS 约 120 MB。

## Completion Summary
- 2026-07-17T15:16:18.947Z 修复 macOS 深色主题：同步原生窗口外观、稳定深色毛玻璃基底、补齐顶栏和设置页控件主题变量；Windows、Agent 安装与现有交互保持不变，自动化与实机验收通过。

## Follow-ups

- 如后续发现低频设置子页仍有独立硬编码色，再按同类控件统一归并，不在本次扩大页面重构范围。
