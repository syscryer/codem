# Session Record: 移动端启动缓存自恢复

- Session: session-20260720-020249-4q6l
- Started: 2026-07-20T02:02:49.775Z
- Task: .trellis/tasks/mobile-startup-cache-recovery.md

## Notes
- 2026-07-20T02:26:22.927Z 定位并修复旧 Service Worker 缓存历史 index/hash 资源导致移动入口无限加载；同时补齐配对 HTTPS 恢复参数和 375px 连接页 box-sizing

- 2026-07-20T02:02:49.781Z Session started.

## Verification

- 2026-07-20T02:27:09.145Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 2 passed
- 2026-07-20T02:27:07.980Z `375px 移动连接页`: React 已挂载；document scrollWidth 375 等于 viewport 375

- 2026-07-20T02:27:06.843Z `移动网关静态资源行为`: 当前入口脚本 200 text/javascript；不存在的历史哈希脚本 404，未回退为 HTML
- 2026-07-20T02:26:39.007Z `真实浏览器恢复 URL`: HTTP 引导页正常生成 https://192.168.31.160:3210/mobile/connect?codem=5；HTTPS 自动化浏览器因当前用户未信任本机 CA 报 ERR_FAILED

- 2026-07-20T02:26:37.880Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 16 passed
- 2026-07-20T02:26:36.809Z `node --test --experimental-strip-types src/mobile/mobile-startup-cache.test.ts`: 4 passed

- 2026-07-20T02:26:35.665Z `npm run build`: 通过；仅有既有大 chunk 警告
- 2026-07-20T02:26:34.520Z `npm run typecheck`: 通过

## Completed

- 2026-07-20T02:27:26.527Z 已修复旧 Service Worker 与历史哈希资源导致的移动启动壳无限加载：SW v5 立即激活并清理旧缓存，导航 no-store/离线独立页，缺失 assets 返回 404，入口与配对链接携带 codem=5，提供清缓存自恢复；并修正 375px 连接页横向溢出。桌面开发模式已重启，3001/3209/3210 正常。当前 Windows 浏览器未信任 CodeM Mobile Local CA，需先通过 3209 引导页安装证书后进入 HTTPS。
