# Task: 手机端内嵌浏览器页

## Background

桌面端有右侧工作台多标签内嵌浏览器（Tauri 子 webview），手机端 PWA 无法复用；此前任务详情里的网页链接只能跳系统浏览器，本地预览链接更是空实现。经讨论确认采用方案 B（内嵌 iframe 浏览器页），主要用例是在手机上查看 agent 产生的本地预览与会话链接。

## Objective

为移动伴侣新增 /mobile/browser 内嵌浏览器页（地址栏+iframe+刷新+自维护历史栈+系统浏览器兜底），任务详情网页链接统一进入该页，本地 localhost 预览地址按当前主机重写

## Scope

In scope:

- `src/mobile/lib/mobile-browser.ts`：URL 工具（回环地址重写、地址栏输入归一化）
- `src/mobile/pages/BrowserPage.tsx`：内嵌浏览器页
- `src/mobile/MobileApp.tsx`：/mobile/browser 路由
- `src/mobile/pages/TaskDetailPage.tsx`：onOpenWebLink 接入内置浏览器
- `src/mobile/mobile.css`：浏览器页样式
- `vite.config.ts`：dev 模式 /api/mobile 网关代理（移动端本地开发此前无法连通网关）

Out of scope:

- 多标签、书签、历史持久化（后续按需再加）
- 服务端代理方案（安全风险，已明确不做）
- onOpenWorkbenchPreview（文件/Diff 预览，属另一个功能域）

## Impact

- 手机端会话中的网页链接不再跳出应用；本地预览（localhost）自动重写为主机地址后在应用内打开
- vite dev 代理新增 /api/mobile 规则，移动端本地开发工作流打通
- 网关安全校验（Origin/Host 一致）不受影响，代理配置明确不去改写 Host

## Acceptance Criteria

- [x] /mobile/browser 路由可达，无 URL 时展示空态引导
- [x] 地址栏回车导航、后退/前进、刷新、系统浏览器兜底按钮全部可用
- [x] localhost/127.0.0.1/[::1] 地址按当前 PWA 主机重写
- [x] 裸 host:port 输入按主机类型补 http/https，非 http scheme 拒绝
- [x] TaskDetailPage 网页链接（非 external 目标）进入内置浏览器页
- [x] typecheck 与移动端单元测试全部通过，隔离环境实测交互正常

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/mobile/*.test.ts`

## Implementation Record
- 2026-08-21T18:20:00.000Z 按用户反馈调整：浏览器从独立整页改为底部导航一级 Tab，替换"通知"入口（通知 Tab 与 /mobile/notifications 路由移除）；BrowserPage 面板常驻挂载（切 Tab 保留地址与历史），带 url 的进入通过 pendingUrl 请求注入导航；样式从 fixed 整页改为填充内容区卡片。

- 2026-08-21T17:35:00.000Z 修复空态首次导航索引越界（用户实测复现）：navigateTo 原固定 setActiveIndex(activeIndex + 1)，无初始网址（entries 为空）时新条目落在索引 0 而索引被设为 1，currentUrl 越界为空、iframe 空白且"后退"假性可用。抽出纯函数 pushBrowserHistoryEntry 并补 3 个单测（空态追加、正常追加、后退后截断前向条目）；BrowserPage 改用该函数。

- 2026-08-21T16:49:59.017Z 实现：新增 src/mobile/lib/mobile-browser.ts（resolveMobileBrowsableUrl 回环地址重写 + normalizeBrowserAddressInput 地址归一化，本地 host:port 补 http、其余补 https、非 http scheme 拒绝）；新增 src/mobile/pages/BrowserPage.tsx（地址栏+iframe+刷新+自维护历史栈+系统浏览器兜底，回车用 onKeyDown 显式处理避免 WebView 隐式提交不稳）；MobileApp 增加 /mobile/browser 路由；TaskDetailPage 的 onOpenWebLink 除 external 目标外统一进入内置浏览器；mobile.css 追加浏览器页样式（复用 --mobile-prototype-* 主题变量，地址胶囊 focus-within 承载焦点）；vite.config 增加 /api/mobile 网关代理（去掉 changeOrigin 以通过网关 Origin/Host 校验，/api/mobile-companion 管理路由排在前避免前缀截胡）

- 2026-08-21T16:34:27.367Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T17:35:00.000Z `隔离环境复测（修复后）`: 从 /mobile/browser 空态输入 localhost:5173/mobile/settings 回车 → 地址归一化、iframe 加载设置页、后退禁用/刷新可用均正确；第二条导航到 projects 后后退回 settings、前进可用；刷新保持当前页；外部站 example.com 补 https 并成功内嵌。`node --import tsx --test src/mobile/mobile-browser.test.ts`: 8 个用例通过；typecheck 通过
- 2026-08-21T16:50:09.919Z `隔离环境浏览器实测（CODEM_APP_DATA_DIR=临时目录 + 伴侣 3211 端口 + vite 代理）`: 登录后 /mobile/browser 路由正常；localhost:5174 输入自动重写为 127.0.0.1:5174；iframe 成功内嵌本地页面（任务页/设置页均渲染）；地址栏回车导航、后退/前进、刷新、系统浏览器按钮状态全部正确；空白提示文案展示正常。隔离环境与临时目录已清理，用户真实 mobile-companion.json 配置核对无改动

- 2026-08-21T16:50:09.412Z `node --import tsx --test src/mobile/*.test.ts`: 移动端 39 个测试全部通过（含 mobile-browser.test.ts 6 个新用例：回环重写、同源保留、非 http 拒绝、裸主机补协议、host:port 分 http/https、scheme 前缀拒绝）
- 2026-08-21T16:50:08.909Z `npm run typecheck`: 通过

## Completion Summary
- 2026-08-21T16:50:33.746Z 手机端内嵌浏览器页完成：/mobile/browser 路由 + 地址栏/iframe/刷新/历史栈/系统浏览器兜底；会话网页链接统一应用内打开；localhost 预览地址自动重写为主机地址；裸 host:port 本地输入补 http。附带打通 vite dev 的 /api/mobile 网关代理。验证：typecheck、39 个移动端测试、隔离环境浏览器实测全部通过；隔离环境已清理，用户真实配置未受影响

## Follow-ups

- 待补充。
