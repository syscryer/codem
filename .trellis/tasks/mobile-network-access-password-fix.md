# Task: 修复移动访问网络范围与密码保存

## Background

移动伴侣当前只绑定 Tailscale IPv4，并在设置页写死 Tailscale 文案，普通可信局域网无法访问。固定密码虽然通常已经写入配置，但保存后仅清空输入框，没有明确成功反馈；同时配置写盘错误被忽略，API 可能误报成功。设置页通用 hover 规则还会覆盖强调按钮背景，导致“保存密码”在鼠标悬停时内容不可见。

## Objective

让移动伴侣同时支持局域网和 Tailscale 访问，并修复固定密码无法可靠保存的问题

## Scope

In scope:

- 移动伴侣监听所有本机 IPv4 网卡，继续仅暴露独立移动网关和既有认证边界。
- 状态 API 返回可用的局域网和 Tailscale 访问地址，设置页逐项展示并复制。
- Windows 防火墙规则限制为本地子网与 Tailscale 网段的移动端口入站访问。
- 固定密码配置使用可靠持久化，写盘失败时 API 返回错误；前端提供清晰的成功与失败反馈。
- 修复设置页 primary 按钮 hover / disabled 状态冲突，并检查同类按钮。

Out of scope:

- 公网中继、TLS、UPnP/NAT 打洞和自动公网暴露。
- 放开桌面内部 API、凭据或完整终端数据。
- 改动桌面工作区、会话和 Agent 主流程。

## Impact

- Backend: `src-tauri/src/mobile_companion.rs` 的监听、状态、Windows 防火墙和 JSON 配置持久化。
- Frontend: `src/components/settings/MobileCompanionSettings.tsx` 的状态契约和反馈；`src/styles.css` 的设置按钮状态。
- Compatibility: 保留旧 `address` / `tailnetAvailable` 字段兼容现有调用，新增 `addresses` 列表供设置页使用。

## Acceptance Criteria

- [x] 开启移动伴侣后监听 `0.0.0.0:<port>`，同一局域网和 Tailscale 均可通过可用 IPv4 地址访问 `/mobile`。
- [x] 设置页不再把移动访问描述为仅限 Tailscale，并能展示、标注和复制多个可用地址。
- [x] 未检测到可用私网地址时显示明确说明，不误导为必须安装 Tailscale。
- [x] 密码少于 8 个字符时显示校验提示；成功后显示“密码已保存”，刷新状态仍为已配置。
- [x] 配置文件写入失败时后端返回错误，不清空前端输入，也不误报保存成功。
- [x] “保存密码”强调按钮在 hover、focus、disabled 状态下文字和图标始终可见。
- [x] 不影响桌面端其他设置按钮、会话和 Agent 主流程。

## Verification Commands

- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 桌面开发模式实测：保存密码、刷新状态、按钮 hover、局域网地址访问。

## Implementation Record
- 2026-08-16T06:30:54.014Z 最终 Runtime 已自动重启：0.0.0.0:3210 正常监听，局域网与 Tailscale 地址可访问，真实密码配置保持；历史防火墙规则范围过宽时状态返回 manual 并在设置页提示。

- 2026-08-16T06:24:30.608Z 完成实现：移动网关监听 0.0.0.0，枚举并过滤可用局域网/Tailscale 地址；配置采用临时文件与回滚写入；密码保存失败恢复内存状态；设置页增加多地址、保存反馈和 primary hover 修复；防火墙状态校验真实网段范围。
- 2026-08-16T05:50:49.874Z 确认问题范围：移动监听扩展到可信局域网与 Tailscale；状态 API 返回多地址；密码写盘错误必须透传；设置页 primary hover 保持强调色和可见内容。

- 2026-08-16T05:45:19.510Z Task created by Trellis automation.

## Verification Results

- 2026-08-16T06:30:52.865Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`: 最终通过，45 个测试全部成功，包含密码接口成功持久化与失败回滚覆盖。
- 2026-08-16T06:24:36.347Z `git diff --check`: 通过，仅有 Git 的 CRLF 转换提醒，无空白符错误。

- 2026-08-16T06:24:35.186Z `局域网/Tailscale 实际访问与桌面视觉验收`: Runtime 监听 0.0.0.0:3210；192.168.31.160 与 100.108.151.13 的 /mobile 均返回 200；密码重启后仍为已配置；桌面设置页显示双地址且按钮内容可见。
- 2026-08-16T06:24:34.074Z `npm run typecheck && npm run build`: 通过；TypeScript 无错误，Vite 生产构建成功（仅保留既有大 chunk 提示）。

- 2026-08-16T06:24:32.889Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`: 通过，45 个移动伴侣测试全部成功；新增地址分类、原子配置替换与失败、密码接口回滚和防火墙范围测试通过。
- 2026-08-16T06:24:31.712Z `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: 通过，无格式差异。

## Completion Summary
- 2026-08-16T06:30:55.148Z 移动伴侣现已支持局域网与 Tailscale 双地址访问；修复密码可靠持久化和成功/失败反馈；修复保存按钮 hover/disabled 样式冲突；过滤虚拟网卡并校验防火墙真实范围。验证包含 45 个 Rust 测试、TypeScript、生产构建、实际双地址访问与桌面视觉检查。

## Follow-ups

- 后续公网访问继续通过独立中继或 TLS 方案设计，不在本次监听扩展中直接暴露公网。
