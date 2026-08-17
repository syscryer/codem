# Task: 移动伴侣固定密码登录

## Background

一次性配对码需要反复在桌面端生成，用户希望在 Tailscale 场景中改为固定账号密码登录，降低日常连接成本。

## Objective

将移动伴侣从一次性配对码改为固定账号密码登录；密码由桌面设置、哈希持久化并可修改，移动端直接输入后建立设备会话，保留 Tailscale HTTP、权限边界和敏感数据脱敏。

## Scope

In scope:

- 固定账号名 `codem`，密码由桌面端设置或修改。
- 使用 Argon2id 加盐哈希持久化密码，不保存或返回明文。
- 手机使用账号密码登录，成功后签发独立 HttpOnly 设备 Token。
- 修改密码时撤销全部旧设备会话，保留设备权限与单设备撤销能力。
- 删除一次性配对码、二维码及相关接口和文案。

Out of scope:

- 多用户、找回密码、外部身份提供商和公网登录。
- 改变 Tailscale HTTP 监听、桌面会话和 Agent API。

## Impact

- `src-tauri/src/mobile_companion.rs`：管理密码、登录、Token 与状态接口。
- `src/components/settings/MobileCompanionSettings.tsx`：桌面密码设置入口。
- `src/mobile/**`：移动登录页、状态类型与 API。

## Acceptance Criteria

- [ ] 未设置密码时移动端不能登录，并提示先在桌面设置。
- [ ] 密码至少 8 个字符，只以 Argon2id 哈希写入配置。
- [ ] 正确账号密码可登录，错误凭据返回统一 401。
- [ ] 登录后可继续使用原设备权限；修改密码后旧 Token 失效。
- [ ] 前后端不再出现一次性配对码或二维码入口。
- [ ] 桌面主流程与桌面会话逻辑不受影响。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`
- 桌面设置密码后，以正确/错误密码实测移动登录、Cookie 和受保护 API。

## Implementation Record
- 2026-08-15T16:08:30.013Z 修复固定密码登录后闪回登录页：移动网关转发 desktop API 时统一携带 Agent Mux Runtime Bearer Token，覆盖 bootstrap、任务流、会话恢复和历史持久化请求。

- 2026-08-15T14:13:54.762Z 已重启 desktop:dev；Tailscale 移动入口返回 auth/status 200，enabled=true、username=codem、passwordConfigured=false；错误密码路径返回 401。管理 API 需桌面运行时 token，未在 shell 伪造写入。
- 2026-08-15T14:10:06.778Z 固定移动伴侣账号密码登录：使用 Argon2id 持久化密码哈希，登录签发 HttpOnly 设备 Token，改密撤销旧设备；前端连接页与桌面移动伴侣设置已切换。

- 2026-08-15T13:58:30.561Z Task created by Trellis automation.

## Verification Results

- 2026-08-15T16:08:30.416Z `cargo check --manifest-path src-tauri/Cargo.toml --locked; cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib; 真实登录与 bootstrap`: 通过：Rust 26/26；Tailscale HTTP 登录 200，携带 Cookie 的 bootstrap 200。
- 2026-08-15T14:10:14.066Z `cargo fmt --manifest-path src-tauri/Cargo.toml; npm run typecheck; node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts; cargo check --manifest-path src-tauri/Cargo.toml --locked; cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib; npm run build`: 通过：前端 24/24；Rust mobile_companion 25/25；cargo check、npm build 成功。

## Completion Summary

- 2026-08-15T16:08:30.834Z 移动登录后的 Runtime Token 转发缺失已修复，回归测试已补充，开发壳已重启并完成真实链路验证。
- 2026-08-15T14:13:55.168Z 固定账号密码登录已落地：Argon2id 哈希、HttpOnly 设备 Token、改密清理设备、移动连接页和桌面设置同步更新；编译、构建、前后端测试通过，开发壳已重启。

## Follow-ups

- 待补充。
