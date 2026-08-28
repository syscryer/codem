# Task: 修复 Hermes CLI Windows 检测盲区与安装误报

## Background

Hermes 官方安装器在 Windows 上把启动器写入 `%LOCALAPPDATA%\hermes\bin`，并通过注册表更新用户 PATH。运行中的 CodeM 不会自动刷新进程 PATH，安装中断时启动器也可能尚未生成，导致实际可用的 Hermes 被误判为未安装。

## Objective

把官方安装器落点纳入 hermes 命令探测候选，探测时合并注册表 User PATH，让中断/新装/在用的 Hermes 都能被正确检测

## Scope

In scope:

- 探测 Windows 与 Unix 官方安装目录中的 Hermes 启动器及安装 venv。
- Windows 探测时合并注册表中的 User 与 Machine PATH。
- 保留旧 TEMP venv 路径作为最低优先级兼容候选。
- 增加路径顺序和注册表 PATH 探测回归测试。

Out of scope:

- 不修改 Hermes 官方安装器或安装流程。
- 不自动终止或迁移已经运行的旧 Hermes 进程。

## Impact

- Backend: `src-tauri/src/backend.rs` 的 Hermes 命令发现逻辑。
- Desktop shell: `src-tauri/src/main.rs` 仅包含 rustfmt 产生的格式调整。
- Persistence / frontend protocol: 无影响。

## Acceptance Criteria

- [x] Windows 优先发现 `%LOCALAPPDATA%\hermes\bin\hermes.exe`。
- [x] 启动器尚未生成时可发现官方 venv 中的 `hermes.exe`。
- [x] Unix 可发现 `~/.hermes/bin/hermes` 及官方 venv 路径。
- [x] 运行中的 CodeM 可读取注册表最新 PATH，无需重启即可发现新安装命令。
- [x] 旧 TEMP venv 路径仍兼容但排在最后。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`

## Implementation Record

- 2026-08-27T12:02:59.371Z 本机即时解困：把 %LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe（v0.20.0，可用）按官方 Install-HermesCommandLaunchers 语义补拷到 %LOCALAPPDATA%\hermes\bin\hermes.exe（该目录已在用户 PATH）。实测：where.exe 找到该路径；新版探测脚本（注册表 PATH 合并 + Get-Command hermes）返回该路径；hermes --version 0.15s 通过 2 秒版本检查窗口。遗留观察：仍有一个 8-25 时代从损坏 TEMP venv 启动的 hermes serve 进程在跑（PID 38708），建议用户重启 CodeM 后由 ensure_backend 用新路径拉起
- 2026-08-27T12:01:00.000Z 改动 src-tauri/src/backend.rs：(1) hermes_command_paths 将官方安装器落点排在最前——Windows %LOCALAPPDATA%\hermes\bin\hermes.exe 与 hermes-agent\venv\Scripts\hermes.exe，Unix ~/.hermes/bin/hermes 与 hermes-agent/venv/bin/hermes（对照官方 install.ps1/install.sh 的固定布局），修复启动器 staged 前的安装状态检测不到的问题；(2) TEMP codem-hermes-venv 降级为最后候选（临时目录随时被清理且已无代码创建它）；(3) 新增 HERMES_WINDOWS_LOOKUP_SCRIPT，Get-Command 探测前把注册表 User+Machine PATH 前置到进程 PATH，安装器刚写完 PATH 即可被运行中的 CodeM 检测到，无需重启。新增 3 个测试 + 更新 1 个旧测试

- 2026-08-27T11:55:32.731Z Task created by Trellis automation.

## Verification Results

- 2026-08-27T12:02:48.024Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过（已先 apply rustfmt）
- 2026-08-27T12:02:47.574Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 585 passed / 0 failed（含新增 hermes_command_paths_cover_official_windows_installer_layout、hermes_command_paths_cover_official_unix_installer_layout、hermes_windows_lookup_script_merges_registry_path，更新 hermes_command_paths_include_codem_isolated_environment 断言 TEMP venv 降级为最后候选）

## Completion Summary
- 2026-08-27T12:02:59.827Z 修复 Hermes CLI Windows 检测盲区：hermes_command_paths 纳入官方安装器落点（Windows %LOCALAPPDATA%\hermes\bin 与 hermes-agent\venv\Scripts；Unix ~/.hermes/bin 与 hermes-agent/venv/bin）并置顶，TEMP codem-hermes-venv 降级为末位兼容候选；Get-Command 探测前置注册表 User+Machine PATH，装完即检、无需重启 CodeM。新增/更新 4 个测试，cargo test 585 全过，rustfmt 通过。本机已补拷 hermes.exe 到 hermes\bin，探测实测通过

## Follow-ups

- 待补充。
