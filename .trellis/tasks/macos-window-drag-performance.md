# Task: 优化 macOS 窗口拖拽性能

## Background

待补充背景。

## Objective

减少 macOS 桌面窗口拖拽时由整窗 CSS backdrop-filter 引起的掉帧，同时保持左侧玻璃材质观感

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record
- 2026-06-24T13:01:55.569Z 校准 macOS 顶栏按钮组垂直位置：trafficLightPosition.y=24 是窗口按钮左上位置，视觉中心约为 31px；将 window-nav top 从 26px 调整为 31px，与红绿灯垂直中心对齐。

- 2026-06-24T13:00:43.013Z 根据最新截图修正 macOS 顶栏按钮组方向：之前 left:170px 使按钮漂到侧栏中部，改为 left:92px/top:26px，让按钮组紧跟红绿灯右侧。
- 2026-06-24T12:55:22.389Z 按 Codex 参考截图继续调整 macOS 左侧布局：window-nav 改为 left:170px/top:26px，使按钮组紧跟红绿灯右侧；--mac-sidebar-top-space 收到 36px，让新建聊天接近参考截图的顶部位置。

- 2026-06-24T12:53:26.597Z 继续根据截图微调 macOS 左侧顶栏：window-nav 从 left:146px/top:24px 调整为 left:126px/top:25px，使按钮组更靠左并校准红绿灯视觉中心；--mac-sidebar-top-space 从 60px 收到 50px，让新建聊天更靠上。
- 2026-06-24T12:50:22.395Z macOS 原生 drag region 对照确认拖拽流畅后，收紧左侧布局：将 --mac-sidebar-top-space 从 76px 调整为 60px；将左侧 window-nav 绝对定位到 top:24px、left:146px，与 trafficLightPosition 的红黄绿按钮垂直中心线对齐。

- 2026-06-24T12:45:39.433Z 根据 Codex 玻璃仍平滑的反馈，改做原生拖拽路径对照：ChatHeader 移除 JS startDragging fallback，给 header/thread-title/h2/span 增加 data-tauri-drag-region，并通过 CSS 标记标题容器为 -webkit-app-region: drag。目的是验证右侧页头能否完全走 Tauri 原生 drag region。
- 2026-06-24T12:43:18.330Z 用户指出 Codex 同样有玻璃效果但拖拽平滑，说明问题不应归因于玻璃视觉本身；后续重点转向 CodeM 的窗口实现差异：transparent WebView、titleBarStyle Overlay、自定义/JS 拖拽路径与系统 titlebar/drag region 的差异。

- 2026-06-24T12:37:10.283Z 为减少拖拽果冻感，将 AppMenubar 和 ChatHeader 的拖拽 fallback 从 pointermove 超过 4px 后启动，改为 pointerdown 立即 startDragging；同时改为静态导入 getCurrentWindow，减少首次拖拽的动态 import/异步延迟。
- 2026-06-24T12:31:56.671Z 用户确认左侧拖拽流畅但右侧页头无法拖动，并且拖动顶栏会选中文字。恢复 ChatHeader 与左侧一致的 startDragging fallback，拖拽开始时 preventDefault；macOS 顶栏和聊天页头补 user-select:none，避免拖动时选中标题文本。

- 2026-06-24T12:22:24.731Z 用户反馈 macOS 窗口拖拽体感仍低帧。进一步将聊天页头和桌面顶栏标记为 data-tauri-drag-region / -webkit-app-region: drag，交互控件设 no-drag，减少 JS pointermove + startDragging 路径参与；同时 macOS 根层显式 backdrop-filter:none，避免 blur(0) 仍触发合成路径。
- 2026-06-24T12:17:06.971Z macOS 已经通过 Rust apply_vibrancy 使用系统级玻璃效果；CSS 根容器的 backdrop-filter blur 会在窗口拖拽时触发大面积重绘。将 macOS --app-material-blur 调整为 0px，并降低 tint alpha，保留视觉层次但避免 WebView 整窗模糊。

- 2026-06-24T12:16:29.081Z Task created by Trellis automation.

## Verification Results
- 2026-06-24T12:37:52.676Z `npm run typecheck && node --import tsx --test src/lib/window-material.test.ts`: 通过；拖拽 fallback 已改为 pointerdown 立即 startDragging，减少启动延迟。HMR 已更新 AppMenubar 和 ChatHeader。

- 2026-06-24T12:23:41.398Z `npm run typecheck; node --import tsx --test src/lib/window-material.test.ts; npm run desktop:dev`: 通过类型检查和窗口材质测试；已重启桌面开发模式以让 macOS 原生 drag region 与合成状态重新生效。
- 2026-06-24T12:18:01.678Z `npm run typecheck && node --import tsx --test src/lib/window-material.test.ts`: 通过；macOS CSS 根容器 blur 改为 0px 后 HMR 已更新。窗口拖拽帧率需在运行中的桌面窗口手动确认。

## Completion Summary

## Follow-ups

- 待补充。
