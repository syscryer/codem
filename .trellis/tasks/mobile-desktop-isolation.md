# Task: 移动伴侣桌面零回归审计

## Background

移动伴侣采用独立 `/mobile` 路由和独立样式，但为了复用桌面会话与后端运行能力，当前改动仍进入了共享 `ConversationPane`、Claude 取消接口和桌面后端启动流程。审计发现两处非必要共享行为变化：桌面 Claude 取消接口的 terminal event 语义被改成 `stopped`，共享会话组件的历史锚点 effect 对所有桌面会话增加了 `turns.length` 触发。需要将这些变化收口为移动端显式 opt-in。

## Objective

隔离移动伴侣的共享行为，保证桌面现有入口、会话、停止语义、滚动机制和样式不发生非必要变化，并完成桌面回归验证

## Scope

In scope:

- 保留桌面 `/api/claude/run/{run_id}` 原有取消与关闭语义。
- 移动端停止请求通过显式内部请求标记获得 `stopped/cancelled` 终态，不改变普通桌面调用。
- 将远程历史分页的滚动锚点刷新限制在移动端显式 prop，桌面与普通聊天继续使用原依赖行为。
- 将移动 PWA Service Worker 作用域收窄到 `/mobile/`，并仅清理 CodeM 移动端遗留的根作用域注册，避免接管桌面 Web 导航。
- 审计移动入口、CSS、设置页、局域网监听默认值和打包资源，区分必要新增与桌面行为回归。
- 增加静态/单元回归测试，验证移动端显式 opt-in 与桌面默认路径隔离。

Out of scope:

- 不移除桌面设置中的“移动伴侣”管理入口；这是用户主动开启和撤销设备的必要控制面。
- 不取消安装包中的移动 PWA 静态资源。
- 不改变移动端页面布局、视觉或权限模型。
- 不回退工作区中的其他既有修改。

## Impact

- `src/components/ConversationPane.tsx`
- `src/mobile/pages/TaskDetailPage.tsx`
- `src/mobile/mobile-conversation-reuse.test.ts`
- `src/mobile/MobileApp.tsx`
- `public/mobile-bootstrap.js`
- `src-tauri/src/backend.rs`
- `src-tauri/src/mobile_companion.rs`
- `.trellis/tasks/mobile-desktop-isolation.md`

## Acceptance Criteria

- [ ] 桌面取消接口在无移动标记时保持原有 `close_thread_runtime` 行为。
- [ ] 只有移动伴侣 stop 代理请求会要求 `stopped/cancelled` terminal event。
- [ ] 桌面和普通聊天不启用远程历史分页锚点触发；移动详情显式启用。
- [ ] `/mobile` 继续独立加载移动 App 与移动 CSS，桌面入口继续加载桌面 App 与桌面 CSS。
- [ ] 移动 Service Worker 只控制 `/mobile/`，桌面路由不受其缓存和离线回退影响。
- [ ] 移动伴侣持久化默认关闭，未开启时不监听局域网端口。
- [ ] 桌面类型检查、前端测试、Rust 测试和生产构建通过。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- `git diff --check`
- 桌面开发模式启动、健康检查和主界面冒烟验证。

## Implementation Record

- 2026-07-21T16:16:25.681Z 完成桌面实际冒烟：CodeM 主界面、既有 ConversationPane 消息/Thinking/操作栏、Composer、模型与推理强度控件均正常；设置页结构正常，移动伴侣仅位于基础设置的独立控制面，当前默认关闭。确认对话组件可复用，其余移动外壳与样式独立。
- 2026-07-21T16:05:08.988Z 完成隔离实现：移动 stop 通过 x-codem-mobile-stop 内部请求头显式选择 stopped/cancelled 终态，桌面无标记 DELETE 恢复原 close_thread_runtime 语义；ConversationPane 仅在 hasEarlierTurns 时用远程历史 turn 数触发锚点；PWA Service Worker 收窄到 /mobile/ 并清理遗留根作用域注册。

- 2026-07-21T15:57:55.043Z Task created by Trellis automation.

## Verification Results
- 2026-07-21T16:16:36.554Z `桌面零回归与移动隔离验收`: pass: typecheck、移动静态/启动测试、Agent 选项测试、cargo fmt、Rust 223 项测试、生产构建、git diff check、桌面窗口实际冒烟均通过；移动 stop、历史分页和 Service Worker 均为显式移动端 opt-in。

## Completion Summary
- 2026-07-21T16:16:46.039Z 完成移动伴侣桌面零回归审计：允许复用 API、类型、事件协议和桌面对话组件；移动端页面外壳、导航、Composer 外壳与 CSS 保持独立。桌面取消语义、会话滚动触发和桌面 Web Service Worker 边界已恢复并收紧，桌面实际冒烟和全量验证通过。

## Follow-ups

- 若未来移动与桌面需要不同的停止策略，优先建立内部 typed control API，避免继续扩展公共桌面取消接口。
