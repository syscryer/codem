# Session Record: 修复移动伴侣开发入口

- Session: session-20260806-160052-lls4
- Started: 2026-08-06T16:00:52.628Z
- Task: .trellis/tasks/mobile-access-fix.md

## Notes
- 2026-08-06T16:01:44.903Z 定位截图中的 500：用户访问的是 Vite HTTP 开发入口 5173，代理仍指向未运行的 3001；真实移动伴侣运行于独立 HTTPS 3210，首次证书引导为 HTTP 3209。基于 Secure Cookie 安全边界，不将真实配对降级到 Vite HTTP 代理。排障过程中产生的 Browser test 设备已撤销，并重新生成一次性配对码。

- 2026-08-06T16:00:52.630Z Session started.

## Verification
- 2026-08-06T16:02:09.453Z `移动安全入口冒烟`: 通过：3209 引导页 200，证书为 application/x-x509-ca-cert 且文件名 codem-mobile-ca.cer；引导页正确链接到 3210 HTTPS 并携带新配对码；3210 pairing status 200 且未配对。

## Completed

- 2026-08-06T16:02:20.471Z 完成移动伴侣配对失败排障：确认 5173 为不适合真实配对的 HTTP Vite 预览入口，真实 3209 证书引导与 3210 HTTPS 配对链路正常；撤销排障测试设备并生成新的一次性配对码。未修改产品代码或桌面端。
