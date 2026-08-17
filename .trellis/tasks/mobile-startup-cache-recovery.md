# Task: 移动端启动缓存自恢复

## Background

真实 Edge 访问 HTTPS `/mobile/connect` 长时间停留在静态启动壳。浏览器受旧 Service Worker 控制，实际使用历史 `index.html` 并请求已不存在的哈希模块；移动静态服务又把缺失的 `/assets/*.js` 回退成 `index.html` 200，最终模块因 MIME 不匹配而无法挂载 React。

## Objective

清理旧 Service Worker 壳缓存并确保移动入口始终加载当前构建

## Scope

In scope:

- Service Worker 立即激活新版本并删除旧移动缓存。
- 导航使用禁用 HTTP 缓存的网络优先策略，仅在真正离线时显示独立离线页。
- 不再由 Service Worker 缓存版本化 JS/CSS，避免新旧模块图混用。
- 更新提示激活 waiting worker 后随 `controllerchange` 刷新。
- 启动兜底支持更新、注销旧 worker、清理移动缓存并带 cache-busting 参数重试。
- 首次安全连接链接携带恢复版本参数，绕过旧 worker 的历史导航缓存。
- 缺失 `/assets/*` 返回 404，不再回退成 HTML。

Out of scope:

- 不改变移动 API、配对 Token、任务数据和桌面会话协议。
- 不清理移动设备 Cookie、凭据或其他站点存储。

## Impact

- `public/mobile-sw.js`、`public/mobile-bootstrap.js`、新增离线页。
- `src/mobile/MobileApp.tsx` 的 SW 更新激活流程。
- `src-tauri/src/mobile_companion.rs` 的静态资源路由与首次连接链接。
- 移动启动缓存自动化测试。

## Acceptance Criteria

- [ ] 历史 SW 控制下使用带版本参数的入口可加载当前构建并挂载 React。
- [ ] 新 SW 安装后立即接管，删除旧 `codem-mobile-*` 缓存。
- [ ] 移动导航在线时始终请求网络，离线时显示独立离线页。
- [ ] 缺失哈希 JS 返回 404，不返回 `text/html` 200。
- [ ] 更新按钮能激活 waiting worker 并在 controller 变化后刷新。
- [ ] 不缓存 `/api/**`、任务正文、Cookie 或凭据。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `node --test --experimental-strip-types src/mobile/mobile-startup-cache.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`
- 浏览器验证旧启动壳通过 cache-busting URL 恢复为真实配对页。

## Implementation Record
- 2026-07-20T02:26:22.927Z 定位并修复旧 Service Worker 缓存历史 index/hash 资源导致移动入口无限加载；同时补齐配对 HTTPS 恢复参数和 375px 连接页 box-sizing

- 2026-07-20T02:02:49.778Z Task created by Trellis automation.

## Verification Results

- 2026-07-20T02:27:09.145Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 2 passed
- 2026-07-20T02:27:07.980Z `375px 移动连接页`: React 已挂载；document scrollWidth 375 等于 viewport 375

- 2026-07-20T02:27:06.843Z `移动网关静态资源行为`: 当前入口脚本 200 text/javascript；不存在的历史哈希脚本 404，未回退为 HTML
- 2026-07-20T02:26:39.007Z `真实浏览器恢复 URL`: HTTP 引导页正常生成 https://192.168.31.160:3210/mobile/connect?codem=5；HTTPS 自动化浏览器因当前用户未信任本机 CA 报 ERR_FAILED

- 2026-07-20T02:26:37.880Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 16 passed
- 2026-07-20T02:26:36.809Z `node --test --experimental-strip-types src/mobile/mobile-startup-cache.test.ts`: 4 passed

- 2026-07-20T02:26:35.665Z `npm run build`: 通过；仅有既有大 chunk 警告
- 2026-07-20T02:26:34.520Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-20T02:27:26.527Z 已修复旧 Service Worker 与历史哈希资源导致的移动启动壳无限加载：SW v5 立即激活并清理旧缓存，导航 no-store/离线独立页，缺失 assets 返回 404，入口与配对链接携带 codem=5，提供清缓存自恢复；并修正 375px 连接页横向溢出。桌面开发模式已重启，3001/3209/3210 正常。当前 Windows 浏览器未信任 CodeM Mobile Local CA，需先通过 3209 引导页安装证书后进入 HTTPS。

## Follow-ups

- 后续原生壳阶段可改用平台推送与更完整的离线状态页；第一阶段不离线保存任务数据。
