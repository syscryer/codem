# Task: 修复 Grok 官方安装目录检测

## Background

Grok 官方安装脚本将 CLI 部署到 `~/.grok/bin/grok`，并更新用户级 PATH。Windows 已运行的桌面进程不会自动刷新注册表 PATH，因此 CodeM 即使在安装完成后仍可能返回“未找到 grok 命令”。

## Objective

让桌面进程在 PATH 尚未刷新时仍能识别官方 ~/.grok/bin 安装的 Grok CLI

## Scope

In scope:

- 保留 `GROK_CLI_PATH` 和当前 PATH 的现有解析顺序。
- 当前 PATH 未命中时，识别 Grok 官方默认安装目录。
- 启动候选命令前验证文件存在且 `--version` 可正常返回。
- 覆盖 Windows 与非 Windows 官方路径生成测试。

Out of scope:

- 不扫描磁盘上的任意 Grok 副本。
- 不修改系统或用户 PATH。
- 不改变 Grok ACP 协议、认证或 Agent 运行逻辑。

## Impact

- `src-tauri/src/backend.rs` 的 Grok CLI 发现逻辑和单元测试。

## Acceptance Criteria

- [x] 当前进程 PATH 不含 Grok 时，仍能发现 `~/.grok/bin/grok.exe`。
- [x] Grok Provider Registry 返回 `available=true`、`selectable=true`。
- [x] Grok 探测接口能启动真实 CLI 并返回版本与认证状态。
- [x] 不影响显式 `GROK_CLI_PATH` 和 PATH 中 Grok 的优先级。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml default_grok_command_path`
- `POST /api/agents/grok/probe`
- `GET /api/agents/providers`

## Implementation Record
- 2026-07-13T06:11:02.303Z 确认官方脚本的标准安装目录为 ~/.grok/bin；后端在环境变量和当前 PATH 均未命中时，验证并使用该官方路径，避免 Windows 已运行桌面进程看不到新 PATH。

- 2026-07-13T05:50:38.284Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T06:15:39.775Z `GET /api/agents/providers 与 POST /api/agents/grok/probe`: 通过：Grok available/selectable=true；真实命令 C:\Users\csm\.grok\bin\grok.exe，版本 0.2.99，ACP 初始化与 cached_token 认证成功，返回 grok-4.5 和 grok-composer-2.5-fast。

- 2026-07-13T06:13:35.056Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：51 passed，0 failed，1 个需显式 GROK_CLI_PATH 的真实 smoke ignored。
- 2026-07-13T06:11:22.118Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust 格式检查无差异。

## Completion Summary
- 2026-07-13T06:19:27.866Z 修复 Grok 官方安装目录检测：即使当前桌面进程未继承新 PATH，也能验证并使用 ~/.grok/bin/grok(.exe)；真实 Provider Registry、ACP 初始化、认证与模型目录均通过。

## Follow-ups

- 无。
