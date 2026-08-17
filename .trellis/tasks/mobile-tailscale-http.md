# Task: 移动伴侣 Tailscale HTTP 访问

## Background

移动伴侣原先通过自签 HTTPS 和独立 HTTP 安全引导页提供局域网访问。用户已在 Tailscale 网络中使用 CodeM，需要移除证书安装与双端口流程；传输加密和网络可达性由 Tailscale 承担。

## Objective

移除移动伴侣自签 HTTPS 与双端口引导，保持独立移动 API 的鉴权与权限边界，仅通过单个 Tailscale HTTP 入口访问。

## Scope

In scope:

- 移动伴侣仅绑定本机 Tailscale IPv4，并通过单一 HTTP 端口提供页面和 API。
- 移除自签证书、证书下载、TLS 监听和安全引导端口。
- 保留一次性配对、设备 Token、权限、响应脱敏、同源 Origin 校验和防火墙规则。
- 在 HTTP 安全上下文不可用时禁用 Service Worker/PWA 通知路径，并更新设置说明。

Out of scope:

- Tailscale 安装、ACL、MagicDNS、HTTPS 反向代理和公网中继。
- 改变桌面端既有 API、路由或会话行为。

## Impact

- `src-tauri/src/mobile_companion.rs` 的独立移动网关与管理 API。
- `src/components/settings/MobileCompanionSettings.tsx` 的移动伴侣设置文案与访问地址。
- `src/mobile/MobileApp.tsx`、`src/mobile/hooks/useMobileWorkspace.ts` 的 PWA 能力降级。
- `src-tauri/Cargo.toml` 的直接 TLS 依赖。

## Acceptance Criteria

- [ ] Tailscale 可用时，移动服务只监听该 Tailscale IPv4 的单一 HTTP 端口。
- [ ] 地址、配对二维码与状态 API 仅返回 HTTP Tailscale 地址，不再生成证书或 HTTPS 引导地址。
- [ ] 未配对访问、设备撤销、设备权限和不可信 Origin 的保护仍然生效。
- [ ] HTTP 页面不注册 Service Worker，也不尝试显示 PWA 通知。
- [ ] 桌面主路由与桌面界面保持不变。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/mobile/mobile-startup-cache.test.ts src/mobile/mobile-conversation-reuse.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`
- 启动桌面开发壳后验证 `http://<Tailscale IPv4>:3210/mobile` 与配对状态 API。

## Implementation Record

- 2026-08-15T04:36:57.191Z 已拉取 origin/main 至 c662777（v0.1.25）并保留本地移动实现；移动伴侣已改为仅绑定 Tailscale IPv4 的单端口 HTTP，移除自签证书、TLS 监听、3209 引导端口和 Secure Cookie 标记；保留 HttpOnly、SameSite=Strict、一次性配对、权限与同源校验。
- 2026-08-15T04:25:17.544Z 用户要求先拉取最新代码；当前 Tailscale HTTP 改造已落盘但尚未验证，拉取前保留全部本地修改。

- 2026-08-14T16:56:00.193Z Task created by Trellis automation.

## Verification Results

- 2026-08-15T04:37:00.204Z `运行桌面开发壳并访问 http://100.108.151.13:3210/mobile、配对状态、未授权 bootstrap 与伪造 Origin`: Tailscale HTTP 页面和状态接口返回 200；未配对 bootstrap 返回 401；伪造 Origin 返回 403；仅 100.108.151.13:3210 监听，3209 与 127.0.0.1:3210 均未监听。
- 2026-08-15T04:36:59.230Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo check --manifest-path src-tauri/Cargo.toml --locked; cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: Rust 格式与编译通过；移动伴侣 25/25 单测通过。

- 2026-08-15T04:36:58.150Z `npm run typecheck; node --import tsx --test src/mobile/mobile-startup-cache.test.ts src/mobile/mobile-conversation-reuse.test.ts; npm run build`: 类型检查通过；19/19 移动端测试通过；Vite 生产构建通过且产物不再包含证书引导文案。

## Completion Summary

- 2026-08-15T04:37:01.280Z 完成移动伴侣 Tailscale HTTP 模式：单端口、仅 Tailnet 地址监听、无证书流程，保留设备鉴权与安全边界；同步完成 v0.1.25 上游拉取、构建、自动化测试和真实端口验证。

## Follow-ups

- 待补充。
