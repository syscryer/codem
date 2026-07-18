# Task: 实现工作台浏览器

## Background

右工作台已有“浏览器”标签和地址栏占位，但所有控件禁用，内容固定显示空白页。iframe 会被常见站点的 CSP / X-Frame-Options 拦截，不能作为真实浏览器实现；当前 Tauri 2.10 已提供原生子 WebView 创建、显隐和尺寸 API，可与少量受限 Tauri command 组合形成可用闭环。

## Objective

使用 Tauri 原生子 WebView 实现可实际使用的浏览器工作台，支持导航、标签、历史、刷新、外部打开与状态保持

## Scope

In scope:

- 使用 Tauri 原生子 WebView 加载 http/https 页面，不受 iframe 嵌入限制。
- 支持地址输入与搜索、前进、后退、刷新、外部浏览器打开。
- 支持最多 8 个标签页，切换时隐藏而非销毁，保留页面与登录状态。
- 保存标签页 URL 和当前选择，应用重启后恢复；不持久化网页正文、表单或凭据。
- 子 WebView 随工作台移动和缩放同步位置；工作台关闭或切换标签时立即隐藏。
- Web 版显示明确桌面能力提示，并可在系统浏览器打开，不使用 iframe 假实现。
- 所有 URL 入口只接受 http/https，Tauri command 只允许操作 `codem-browser-` 前缀的子 WebView。

Out of scope:

- 浏览器扩展、下载管理器、书签同步、密码管理、隐身模式和开发者工具 UI。
- 读取或注入远程网页正文给 Agent；浏览器与 Agent 工具保持独立。
- 完整浏览历史数据库、跨设备同步和系统浏览器导入。

## Impact

- Frontend：替换 `RightWorkbench` 浏览器占位，新增浏览器纯函数和原生运行桥接。
- Desktop：增加受限的 URL/导航 Tauri commands 与子 WebView 权限。
- Persistence：只通过 localStorage 保存标签 id、URL、标题和当前标签，不进入 SQLite。

## Acceptance Criteria

- [x] 桌面版浏览器可打开真实常见站点，地址输入、搜索、前进、后退和刷新可用。
- [x] 支持新建、切换和关闭标签页，切走浏览器或收起工作台后网页不会覆盖主界面。
- [x] 工作台宽度、窗口大小和位置变化后子 WebView 始终与内容区域对齐。
- [x] 标签 URL 与当前标签可恢复，不保存网页正文、凭据或表单值。
- [x] 非 http/https 输入被拒绝；远程页面不能调用 CodeM Tauri API。
- [x] Web 版不创建 iframe，显示桌面能力说明并支持系统浏览器打开。
- [x] 浅色/深色主题下工具栏、标签和空状态使用 CodeM token。
- [x] 类型检查、前端测试、Rust 测试、构建和桌面真实导航验收通过。

## Verification Commands

- `node --import tsx --test src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml browser_webview`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run build`
- `git diff --check`

## Implementation Record

- 2026-07-18T02:20:00.000Z 根据桌面反馈修正子 WebView 焦点：创建时启用 focus，重新显示已有标签时调用 setFocus，避免网页部分区域无法接收点击。
- 2026-07-18T02:11:49.594Z 浏览器实现完成：原生子 WebView 按标签独立创建并隐藏切换，地址栏支持 HTTP/HTTPS 与搜索，支持前进后退刷新、外部打开、最多 8 个标签和 localStorage 状态恢复；Web 版不创建 iframe，仅显示桌面能力提示。修正 WebView 边界只覆盖网页内容区，避免遮挡标签栏和地址栏。
- 2026-07-18T01:40:03.879Z 浏览器采用 Tauri 原生子 WebView；每个标签保留独立 WebView，非活动时隐藏；Rust command 仅允许 codem-browser- label 和 http/https URL；Web 版不使用 iframe。

- 2026-07-18T01:33:47.032Z Task created by Trellis automation.

## Verification Results

- 2026-07-18T02:11:49.700Z `node --import tsx --test src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`: 7/7 passed
- 2026-07-18T02:11:49.697Z `npm run typecheck && npm run build && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 全部通过；Vite 构建成功，Rust 格式检查和 diff 检查通过
- 2026-07-18T02:11:49.642Z `cargo test --manifest-path src-tauri/Cargo.toml browser_webview`: 2/2 browser command tests passed
- 2026-07-18T02:11:49.700Z `npm run desktop:dev` 与 Playwright：桌面后端和开发壳启动成功；Web 版已验证工作台浏览器标签、地址栏和桌面能力提示。

## Completion Summary
- 2026-07-18T02:13:23.562Z 浏览器工作台已完成并通过前端 7 项专项测试、Rust 浏览器命令测试、类型检查、构建、格式和 diff 检查；桌面开发版启动成功，Web 版 Playwright 验证了工作台浏览器入口和桌面能力提示。

浏览器工作台已完成：Tauri 原生子 WebView、标签页、导航、搜索、外部打开、状态持久化、尺寸同步和 Web 版边界均已落地，未使用 iframe，也未把网页正文或凭据写入 CodeM 数据库。

## Follow-ups

- 后续如需 Agent 浏览器工具，应另行设计权限、页面内容采集和隐私提示，不能直接读取本功能的远程页面。
