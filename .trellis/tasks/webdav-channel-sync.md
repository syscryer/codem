# Task: WebDAV 渠道同步（含密钥）

## Background

用户希望在 CodeM 中加入 mxterm 已有的 WebDAV 同步能力（用户口中的 "webdev"，参考 D:\Projects\mxterm 设置页「同步」分区）。经方案讨论（聊天记录 2026-08-15），用户确认一期范围收窄为：只同步 Agent 渠道，包含渠道 API Key。

mxterm 参考实现要点（调研结论）：

- 三文件快照：`{remote_root}/v1/{profile}/` 下 `manifest.json`（最后上传，保证远端原子性）、`data.json`（明文结构化数据）、`secrets.enc`（可选加密凭据）。
- 传输层 trait 只有 propfind / mkcol / put / get 四个动词，与业务解耦。
- 双层密码：WebDAV 服务密码本机保存（UI 只回传已保存布尔）；加密 secrets 的同步主密码每次输入、绝不落盘。
- Argon2id 派生 key + AES-256-GCM，AAD 绑定快照上下文防密文调包。
- 下载侧：manifest 兼容校验 → sha256 校验 → 引用完整性校验 → 导入前备份 → 事务内全量替换（不做字段级合并）。
- 同步互斥锁、响应大小限制、错误信息 URL 脱敏。

## Objective

新增设置页「同步」分区，支持把 Agent 渠道（`agent_channels` + `agent_channel_models`）及渠道 API Key 通过 WebDAV 手动上传/下载；快照三文件协议 + 同步主密码加密；导入前备份、事务替换。

## Scope

In scope:

- 后端新增独立 Rust module（WebDAV 传输层 + 渠道同步编排），REST 路由挂到现有 Axum router。
- 快照协议：`codem-channel-sync` format，manifest/data/secrets 三文件，manifest 最后上传。
- `data.json` 导出 agent_channels、agent_channel_models 全部行；`secrets.enc` 加密导出所有 `agent-channel:{id}` 密钥。
- WebDAV 服务配置（地址/用户名/密码/远端目录/profile）持久化到 `{app_data_dir}/webdav-sync.json`；密码存 SecretStore（slot `webdav-sync:password`），前端只拿 `passwordSaved` 布尔。
- 上传/下载均为手动触发，带确认；下载导入前备份 `codem.sqlite` 与 `ai-secrets.enc` 到 `backups/channel-sync/latest/`；导入在事务内全量替换两张渠道表 + 清理线程悬空渠道引用 + 重写 agent-channel 密钥槽。
- 同步互斥锁（try_lock 报错）、响应大小限制、错误信息 URL 脱敏。
- 前端：`SettingsSection` 新增 `sync`，新组件按现有 SettingsGroup/SettingsRow/dialog-backdrop 风格实现，不用 window.confirm/alert。

Out of scope（用户已确认）:

- 不同步应用设置（settings.json：外观、代理、快捷键等）。
- 不同步 MCP / Skills / 插件配置（属各 Agent 原生配置文件）。
- 不同步项目/线程/消息/工作流等业务数据。
- 不做字段级合并，只做全量替换；不做自动/定时同步，仅手动。
- 不做本地文件导入导出变体（二期候选）。
- WebDAV 流量不接 CodeM 网络代理配置，直连。

## Impact

- backend：新增 `src-tauri/src/webdav_sync.rs`（传输 + 编排 + 路由）；`backend.rs` 挂载 router；`ordinary_chat/secrets.rs` 增加 slots 枚举方法；`Cargo.toml` 新增 argon2 依赖。
- frontend：`src/types.ts`（SettingsSection + 同步类型）、`src/components/settings/WebDavSyncSettingsSection.tsx`（新）、`SettingsView.tsx`、`SettingsSidebar.tsx`。
- 不改 agent_channels 现有表结构与行为；导入复用现有 schema。

## Acceptance Criteria

- [x] 两台机器 A 上传、B 下载后渠道（含模型、默认位、启停位）与 API Key 完全一致，无需手动补录密钥。（以 Rust 集成测试 channel_snapshot_roundtrip_with_secrets 双目录模拟两台机器验证）
- [x] 远端三个文件不含明文密钥；日志与错误信息不出现密码（URL 脱敏）。
- [x] 下载前 remote-info 可展示远端快照来源设备/时间/兼容性；不兼容 manifest 直接拒绝。
- [x] 存在已保存密钥时上传必须输入同步主密码，否则明确报错。
- [x] 导入前自动备份；导入校验失败（sha256/协议/引用完整性）不会写库。
- [x] 并发触发同步返回明确错误。
- [x] Rust 单测：快照 roundtrip、加密信封（含错误密码失败）、上传顺序（manifest 最后）、不兼容 manifest 拒绝、假传输层上传/下载编排。（9 个用例全部通过）

## Verification Commands

- cargo test --manifest-path src-tauri/Cargo.toml webdav_sync
- cargo check --manifest-path src-tauri/Cargo.toml
- npx tsc --noEmit（前端类型）

## Implementation Record
- 2026-08-14T17:45:49.224Z 完成审查修复：SecretStore 新增同锁范围的 prefix 替换+数据库操作失败回滚，避免并发密钥更新被覆盖；导入完整清理悬空渠道线程的 session/transcript/model/reasoning/model preferences；WebDAV 设置使用 Windows 可覆盖且失败可恢复的文件替换；密钥信封解密前校验 16 字节 salt、12 字节 nonce 与明文协议版本；新增 4 类回归测试，专项用例由 9 增至 13。

- 2026-08-14T17:35:37.961Z 代码审查确认四项修复：下载导入需避免数据库已提交但密钥写入失败；悬空渠道线程需同步清理 session/model/偏好；webdav-sync.json 在 Windows 需支持覆盖；密钥信封 salt/nonce 长度需在 AES-GCM 调用前校验。
- 2026-08-14T17:04:10.678Z 实现 WebDAV 渠道同步：新增 src-tauri/src/webdav_sync.rs（WebDavTransport trait + reqwest 传输、codem-channel-sync 三文件快照协议、Argon2id+AES-256-GCM 密钥信封含 AAD 绑定、上传 manifest 最后写入、下载 manifest/哈希/引用完整性三重校验、导入前 SQLite backup API 备份、事务内全量替换两张渠道表并清理线程悬空引用、tokio Mutex 同步互斥）；SecretStore 增加 entries_with_prefix/replace_prefix；agent_channels 放出 validate_protocol/repair_default_channel 等 pub(crate)；后端新增 5 条 /api/sync/webdav/* 路由；前端设置页新增「同步」分区（服务配置/远端快照/手动同步三张卡 + 确认弹窗），types.ts 增加 SettingsSection sync 与 WebDAV 同步类型；Cargo.toml 新增 argon2，rusqlite 增加 backup feature

- 2026-08-14T16:36:50.511Z Task created by Trellis automation.
- 2026-08-15 方案讨论收敛：只同步渠道 + 密钥；全量替换 + 备份；直连；参考 mxterm WebDAV 同步设计。

## Verification Results
- 2026-08-14T17:45:50.577Z `重启 npm.cmd run desktop:dev；读取 Agent Mux runtime discovery 并带 Bearer token 请求 /api/health 与 /api/sync/webdav/settings`: 桌面开发壳已重启；Web 5173 返回 200；动态 Rust Runtime 53842 健康且同步路由返回正常

- 2026-08-14T17:45:50.296Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check && cargo check --manifest-path src-tauri/Cargo.toml`: 格式、diff 与 Rust 编译检查通过（仅既有 dead_code warnings）
- 2026-08-14T17:45:50.027Z `npm run typecheck && node --import tsx --test src/components/SidebarProjects.status-icons.test.ts src/hooks/useAgentChannels.test.ts`: TypeScript 类型检查通过；3 个前端回归测试通过

- 2026-08-14T17:45:49.762Z `NO_PROXY=127.0.0.1,localhost cargo test --manifest-path src-tauri/Cargo.toml`: 508 passed, 0 failed, 1 ignored；全部二进制测试通过
- 2026-08-14T17:45:49.489Z `cargo test --manifest-path src-tauri/Cargo.toml webdav_sync`: 13 passed, 0 failed

- 2026-08-14T17:04:16.949Z `node --import tsx --test src/components/SidebarProjects.status-icons.test.ts src/hooks/useAgentChannels.test.ts`: 3 个用例全部通过
- 2026-08-14T17:04:16.558Z `curl http://127.0.0.1:3001/api/sync/webdav/settings 等冒烟`: GET 默认设置、未启用拦截上传/读取远端、非法服务地址校验均按预期返回中文错误信息

- 2026-08-14T17:04:16.140Z `npx tsc --noEmit`: 通过，无类型错误
- 2026-08-14T17:04:15.735Z `cargo test --manifest-path src-tauri/Cargo.toml`: 503 passed / 1 failed / 1 ignored：唯一失败用例 ordinary_chat::provider::tests::request_errors_include_the_original_cause_without_url_secrets 为本机系统代理导致的环境问题（对该用例单独设置 NO_PROXY=127.0.0.1 后通过），与本次改动无关；webdav_sync 9 个新用例全部通过（roundtrip/上传顺序/加密信封/错误密码/篡改拒绝/不兼容 manifest/并发锁/短密码）

## Completion Summary

- 2026-08-14T17:46:10.504Z 修复 WebDAV 渠道同步审查问题：密钥替换与数据库导入在同一 SecretStore 锁内执行并在失败时恢复；悬空渠道线程完整清除会话、模型和偏好；Windows 可重复保存同步设置；损坏 salt/nonce/密钥版本安全拒绝。新增 4 类回归测试，专项 13/13、全量 Rust 508 passed/1 ignored、typecheck 和前端回归通过；桌面开发壳已重启并验证动态 Rust Runtime 与同步路由。
- 2026-08-14T17:04:33.923Z WebDAV 渠道同步（含密钥）完成：设置页新增同步分区，渠道+API Key 三文件快照手动上传/下载，主密码加密、导入前备份、事务全量替换，9 个 Rust 单测 + tsc + API 冒烟验证通过

设置页新增「同步」分区，支持把 Agent 渠道（agent_channels + agent_channel_models）与渠道 API Key 通过用户自建 WebDAV 手动上传/下载：远端为 `{remote_root}/v1/{profile}/` 下 manifest.json / data.json / secrets.enc 三文件快照，manifest 最后上传保证原子性；API Key 用同步主密码（Argon2id + AES-256-GCM，AAD 绑定快照上下文）加密，主密码不落盘；WebDAV 服务密码存本机 SecretStore，前端只回传 passwordSaved；下载前 manifest/协议/哈希/引用完整性校验，导入前自动备份 codem.sqlite 与密钥库到 backups/channel-sync/latest，事务内全量替换并清理线程悬空渠道引用；同步互斥锁防并发。前端在下载成功后自动刷新渠道 bootstrap。验证：webdav_sync 9 个 Rust 用例、全量 cargo test（唯一失败为本机代理环境问题）、tsc、API 冒烟全部通过。开发服务当时未在运行，无需重启。

## Follow-ups

- 二期候选：本地加密文件导入导出（同一快照协议的本地变体）、远端快照多版本历史。
- WebDAV 请求当前走系统默认网络栈；如需跟随「网络代理」设置，需在 transport 构造时注入 CodeM 代理（已在 Out of scope 声明）。
