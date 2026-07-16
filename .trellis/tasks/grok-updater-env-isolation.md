# Task: Grok 更新器环境隔离

## Background

CodeM 桌面开发版通过 npm 脚本启动，因此 Rust/Tauri 进程会继承 `npm_config_user_agent`。Grok Build 官方更新器把这个父进程变量误认为自身通过 npm 安装，将实际位于 `~/.grok/bin/grok.exe` 的官方安装错误识别为 `installer=npm`，最终返回 `program not found`。同一命令在普通终端中会正确识别为 `installer=internal`。

## Objective

修复桌面开发模式继承 npm_config_user_agent 导致 Grok 官方更新器误判安装方式并无法查询或更新的问题

## Scope

In scope:

- 隔离 Grok 最新版本查询子进程中的父级 npm user-agent。
- 隔离 Grok 安装/更新生命周期子进程中的父级 npm user-agent。
- 补充子进程环境回归测试，确认其他 Agent 不受影响。

Out of scope:

- 不改变 Grok 聊天、ACP、认证和模型配置。
- 不执行真实 Grok 更新。
- 不清理其他 npm 环境变量。

## Impact

- Backend: Grok updater command environment only.

## Acceptance Criteria

- [x] npm 启动的桌面开发版能够查询 Grok 最新版本。
- [x] Grok 生命周期子进程不再把 CodeM 的 npm 启动上下文当作 Grok 安装方式。
- [x] Claude、Codex、OpenCode 生命周期子进程环境保持不变。
- [x] 不执行真实更新即可覆盖环境隔离回归测试。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`
- `Invoke-RestMethod 'http://127.0.0.1:3001/api/agents/latest-version?providerId=grok-build&currentVersion=0.2.99'`
- `git diff --check`

## Implementation Record
- 2026-07-16T06:55:41.920Z 已在 Grok 最新版本查询和 Grok 生命周期子进程中移除父进程 npm_config_user_agent；其他 Agent 保持继承原环境，并补充命令环境单元测试。

- 2026-07-16T06:52:34.941Z Task created by Trellis automation.
- 2026-07-16 根因复现：桌面进程环境下 Grok 返回 `installer=npm/error=program not found`；只移除 `npm_config_user_agent` 后返回 `installer=internal/latestVersion=0.2.101`。
- 2026-07-16 Grok 版本查询和 Grok 生命周期命令统一清理父级 npm user-agent，其他 Provider 保持原环境。

## Verification Results

- 2026-07-16T07:02:39.414Z `git diff --check`: pass（仅既有 CRLF 提示）
- 2026-07-16T07:02:38.479Z `GET /api/agents/latest-version?providerId=grok-build&currentVersion=0.2.99`: pass：latestVersion=0.2.101，updateAvailable=true，error=null

- 2026-07-16T07:02:37.540Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: pass：仅两个既存 dead_code warning
- 2026-07-16T07:02:36.482Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

- 2026-07-16T07:02:35.396Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass：Rust 145/145，1 个显式忽略的真实 Grok smoke
- 2026-07-16T07:02:34.388Z `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle`: pass：8/8

- `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle`：通过，8/8。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`：通过，仅有两个既存 `dead_code` warning。
- 真实桌面后端接口返回 `latestVersion=0.2.101`、`updateAvailable=true`、`error=null`。

## Completion Summary
- 2026-07-16T07:02:54.356Z 修复 Grok 更新器继承 CodeM npm user-agent 后误判安装方式的问题；版本查询与更新链路统一隔离该变量，其他 Agent 环境不变，真实接口和完整 Rust 测试通过。

隔离了 Grok 官方更新器与 CodeM npm 开发壳的启动环境，避免 Grok 将父进程的 npm user-agent 误判为自身安装方式。查询和更新共用同一隔离逻辑，其他 Agent 不受影响。

## Follow-ups

- 暂无。
