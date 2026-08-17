# Session Record: 修复移动 HTTPS 首屏加载

- Session: session-20260719-032657-3dt3
- Started: 2026-07-19T03:26:57.073Z
- Task: .trellis/tasks/mobile-startup-fix.md

## Notes

- 2026-07-19T03:47:34.592Z 定位根因：HTTPS 模块请求使用 HTTP/2，主机信息位于 URI :authority 而非普通 Host 头；移动安全中间件因此把合法 Origin 误判为伪造来源并返回 403。已改为 Host 优先、URI authority 兜底，并对允许的静态 Origin 返回精确 CORS 头，保留伪造 Origin 403。
- 2026-07-19T03:27:03.767Z 确认 3210 HTTPS 服务和证书可用；普通浏览器访问 /mobile 仍停留在静态启动壳，HTTP 5174 移动入口可正常挂载 React。下一步针对 Rust 静态产物的 module script 执行链路定位。

- 2026-07-19T03:26:57.081Z Session started.

## Verification

- 2026-07-19T03:47:51.028Z `伪造 Origin 请求静态资源`: 通过：仍返回 403 请求来源不受信任
- 2026-07-19T03:47:49.682Z `浏览器访问 https://192.168.31.160:3210/mobile（375x812）`: 通过：React 配对页完成挂载，宽度 375px 无横向溢出，不再停留在启动壳

- 2026-07-19T03:47:48.419Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 通过：7 个移动伴侣测试全部通过，含 HTTP/2 authority 回归测试
- 2026-07-19T03:47:47.357Z `npm run build`: 通过：TypeScript 和 Vite production build 完成

## Completed

- 2026-07-19T03:47:57.519Z 修复移动 HTTPS 首屏：安全中间件兼容 HTTP/2 URI authority，合法模块请求不再被误判为伪造 Origin；补充回归测试并完成 375px 浏览器实测。
