# Task: 修复普通聊天桌面端供应商模板跨域

## Background

全局设置中的“AI 供应商”页面在 Web 开发模式下可以通过 Vite 代理读取模板，但桌面 WebView 会把 `/api` 请求改写为直连 Rust 后端。现有 CORS 层只应用在基础路由上，普通聊天路由在 CORS 层之后才合并，导致 `/api/ai/providers/templates` 的桌面跨域响应缺少允许源头，前端表现为常用厂商区域空白并显示 `Failed to fetch`。

## Objective

让桌面 WebView 能正常加载普通聊天供应商模板，统一所有后端路由的 CORS 覆盖范围并补充回归验证

## Scope

In scope:

- 调整 Rust 后端路由组装顺序，使桌面 CORS 层覆盖基础 API、Agent API 和普通聊天 API。
- 保持现有本地来源白名单和请求方法、请求头策略不变。
- 增加普通聊天供应商模板接口的桌面来源回归测试。
- 重启桌面开发模式并验证常用厂商模板可以正常显示。
- 将常用厂商改为不分地区的统一列表，增加厂商搜索、品牌图标并提升列表字号。

Out of scope:

- 不在前端复制供应商模板作为兜底数据源。
- 不放宽到任意远程来源，不改变供应商模板内容和用户配置。

## Impact

- Backend：`src-tauri/src/backend.rs` 的 Router 合并与 CORS 层顺序。
- Desktop：Tauri WebView 直连普通聊天 API 的跨域访问。
- Web：仍通过 Vite 代理访问，不改变现有请求路径。
- Frontend：供应商模板统一列表、搜索、品牌图标和字号层级。

## Acceptance Criteria

- [x] 带本地桌面 Origin 的 `/api/ai/providers/templates` 响应包含正确的 `Access-Control-Allow-Origin`。
- [x] 原有 Agent 运行预检 CORS 行为保持通过。
- [x] 全局设置“AI 供应商”页显示内置常见厂商，不再出现 `Failed to fetch`。
- [x] 常用厂商统一展示，可按名称、标识或 API 地址搜索，每项显示品牌图标和更清晰的字号。
- [x] Rust 定向测试、TypeScript 检查和 `git diff --check` 通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml desktop_cors --lib`
- `npm run typecheck`
- `git diff --check`
- `npm run desktop:dev` 后真实验证全局设置中的供应商模板。

## Implementation Record

- 2026-07-14T02:42:56.708Z 按用户反馈调整常用厂商区：取消国内外/聚合平台分组，改为统一列表；增加名称、标识和 API 地址搜索；引入本地品牌 SVG 图标并提升厂商名称、行高和侧栏宽度。图标子集来源已在资产目录记录 MIT 来源。
- 2026-07-14T02:29:24.848Z 已确认根因：普通聊天 Router 在基础 Router 的 CORS layer 之后 merge，导致桌面 WebView 直连 /api/ai 路由时响应缺少跨域头；已将 CORS 统一移动到全部路由合并之后，并扩展桌面 CORS 回归测试覆盖供应商模板接口。

- 2026-07-14T02:27:07.283Z Task created by Trellis automation.

## Verification Results

- 2026-07-14T02:48:21.603Z `git diff --check && git diff --cached --check`: pass: 工作树与暂存区无空白错误
- 2026-07-14T02:48:21.297Z `浏览器打开 http://127.0.0.1:5175/ 并搜索 deep`: pass: 统一厂商列表、品牌图标、大字号可见，搜索只保留 DeepSeek，控制台无错误

- 2026-07-14T02:48:20.991Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: pass: 29 项 Rust ordinary_chat 测试
- 2026-07-14T02:48:20.698Z `node --import tsx --test src/lib/provider-template-search.test.ts src/lib/ordinary-chat-settings.test.ts src/lib/composer-keyboard.test.ts`: pass: 6 项普通聊天设置、供应商搜索和 Enter 契约测试

- 2026-07-14T02:48:20.381Z `npm run build`: pass: TypeScript 检查与 Vite 生产构建通过
- 2026-07-14T02:30:16.385Z `cargo test --manifest-path src-tauri/Cargo.toml desktop_cors_covers_agent_and_ordinary_chat_routes --lib`: pass: Agent 预检与普通聊天供应商模板接口均返回本地桌面 CORS 头

## Completion Summary
- 2026-07-14T02:49:10.717Z 修复普通聊天供应商模板桌面跨域加载；统一常用厂商列表并增加搜索、9 个官方品牌图标和更清晰字号；TypeScript、生产构建、Rust ordinary_chat、前端定向测试、浏览器真实验证和 diff 检查均通过。

普通聊天供应商模板的桌面跨域问题已修复，所有后端路由统一经过本地 CORS 层；全局 AI 供应商页已改为统一可搜索厂商列表，加入 9 个官方供应商品牌图标并提升字号，浏览器真实验证通过。

## Follow-ups

- 无。
