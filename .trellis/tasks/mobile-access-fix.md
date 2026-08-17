# Task: 修复移动伴侣局域网访问

## Background

待补充背景。

## Objective

确保用户主动开启移动伴侣后，Windows 局域网设备可访问 3210 HTTPS 端口，并对证书和防火墙失败提供明确反馈。

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

- 2026-08-06T16:01:44.903Z 定位截图中的 500：用户访问的是 Vite HTTP 开发入口 5173，代理仍指向未运行的 3001；真实移动伴侣运行于独立 HTTPS 3210，首次证书引导为 HTTP 3209。基于 Secure Cookie 安全边界，不将真实配对降级到 Vite HTTP 代理。排障过程中产生的 Browser test 设备已撤销，并重新生成一次性配对码。
- 2026-07-19T03:00:46.987Z 定位并修复移动端一直加载：移动 HTTPS 根路径原先加载桌面 App，改为 307 跳转到 /mobile/connect；Windows WLAN 为 Public 且 3210 无入站例外，新增受控 CodeM Mobile Companion 防火墙规则配置与状态反馈，设置页提示未放行状态。当前开发机已通过 UAC 建立 TCP 3210 规则。

- 2026-07-19T02:54:11.818Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T16:02:09.453Z `移动安全入口冒烟`: 通过：3209 引导页 200，证书为 application/x-x509-ca-cert 且文件名 codem-mobile-ca.cer；引导页正确链接到 3210 HTTPS 并携带新配对码；3210 pairing status 200 且未配对。

- 2026-07-19T03:00:49.536Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib && npm run typecheck`: 通过：移动模块 6 项测试全部通过，TypeScript 检查通过。
- 2026-07-19T03:00:48.090Z `移动访问冒烟`: 通过：GET https://127.0.0.1:3210/ 返回 307 Location=/mobile/connect；GET https://192.168.31.160:3210/mobile/connect 返回 200；HTTP 明文访问被拒绝；admin status 返回 firewall=configured、address=https://192.168.31.160:3210。

## Completion Summary

- 2026-08-06T16:02:20.471Z 完成移动伴侣配对失败排障：确认 5173 为不适合真实配对的 HTTP Vite 预览入口，真实 3209 证书引导与 3210 HTTPS 配对链路正常；撤销排障测试设备并生成新的一次性配对码。未修改产品代码或桌面端。
- 2026-07-19T03:00:50.863Z 修复移动伴侣局域网访问和根路径加载问题：移动端口根地址自动进入移动连接页；Windows 防火墙端口例外随启停/端口变更管理并在桌面设置反馈状态；当前开发服务已重启，3210 HTTPS 可用。

## Follow-ups

- 待补充。
