# Session Record: 修复移动伴侣局域网访问

- Session: session-20260719-025411-n7zs
- Started: 2026-07-19T02:54:11.816Z
- Task: .trellis/tasks/mobile-access-fix.md

## Notes
- 2026-07-19T03:00:46.987Z 定位并修复移动端一直加载：移动 HTTPS 根路径原先加载桌面 App，改为 307 跳转到 /mobile/connect；Windows WLAN 为 Public 且 3210 无入站例外，新增受控 CodeM Mobile Companion 防火墙规则配置与状态反馈，设置页提示未放行状态。当前开发机已通过 UAC 建立 TCP 3210 规则。

- 2026-07-19T02:54:11.820Z Session started.

## Verification

- 2026-07-19T03:00:49.536Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib && npm run typecheck`: 通过：移动模块 6 项测试全部通过，TypeScript 检查通过。
- 2026-07-19T03:00:48.090Z `移动访问冒烟`: 通过：GET https://127.0.0.1:3210/ 返回 307 Location=/mobile/connect；GET https://192.168.31.160:3210/mobile/connect 返回 200；HTTP 明文访问被拒绝；admin status 返回 firewall=configured、address=https://192.168.31.160:3210。

## Completed

- 2026-07-19T03:00:50.863Z 修复移动伴侣局域网访问和根路径加载问题：移动端口根地址自动进入移动连接页；Windows 防火墙端口例外随启停/端口变更管理并在桌面设置反馈状态；当前开发服务已重启，3210 HTTPS 可用。
