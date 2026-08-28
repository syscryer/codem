# Session Record: 修复 Hermes CLI Windows 检测盲区与安装误报

- Session: session-20260827-115532-fdwj
- Started: 2026-08-27T11:55:32.729Z
- Task: .trellis/tasks/hermes-cli-detection.md

## Notes

- 2026-08-27T12:02:59.371Z 本机即时解困：把 %LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe（v0.20.0，可用）按官方 Install-HermesCommandLaunchers 语义补拷到 %LOCALAPPDATA%\hermes\bin\hermes.exe（该目录已在用户 PATH）。实测：where.exe 找到该路径；新版探测脚本（注册表 PATH 合并 + Get-Command hermes）返回该路径；hermes --version 0.15s 通过 2 秒版本检查窗口。遗留观察：仍有一个 8-25 时代从损坏 TEMP venv 启动的 hermes serve 进程在跑（PID 38708），建议用户重启 CodeM 后由 ensure_backend 用新路径拉起
- 2026-08-27T12:01:00.000Z 改动 src-tauri/src/backend.rs：(1) hermes_command_paths 将官方安装器落点排在最前——Windows %LOCALAPPDATA%\hermes\bin\hermes.exe 与 hermes-agent\venv\Scripts\hermes.exe，Unix ~/.hermes/bin/hermes 与 hermes-agent/venv/bin/hermes（对照官方 install.ps1/install.sh 的固定布局），修复启动器 staged 前的安装状态检测不到的问题；(2) TEMP codem-hermes-venv 降级为最后候选（临时目录随时被清理且已无代码创建它）；(3) 新增 HERMES_WINDOWS_LOOKUP_SCRIPT，Get-Command 探测前把注册表 User+Machine PATH 前置到进程 PATH，安装器刚写完 PATH 即可被运行中的 CodeM 检测到，无需重启。新增 3 个测试 + 更新 1 个旧测试

- 2026-08-27T11:55:32.732Z Session started.

## Verification

- 2026-08-27T12:02:48.024Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过（已先 apply rustfmt）
- 2026-08-27T12:02:47.574Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 585 passed / 0 failed（含新增 hermes_command_paths_cover_official_windows_installer_layout、hermes_command_paths_cover_official_unix_installer_layout、hermes_windows_lookup_script_merges_registry_path，更新 hermes_command_paths_include_codem_isolated_environment 断言 TEMP venv 降级为最后候选）

## Completed

- 2026-08-27T12:02:59.827Z 修复 Hermes CLI Windows 检测盲区：hermes_command_paths 纳入官方安装器落点（Windows %LOCALAPPDATA%\hermes\bin 与 hermes-agent\venv\Scripts；Unix ~/.hermes/bin 与 hermes-agent/venv/bin）并置顶，TEMP codem-hermes-venv 降级为末位兼容候选；Get-Command 探测前置注册表 User+Machine PATH，装完即检、无需重启 CodeM。新增/更新 4 个测试，cargo test 585 全过，rustfmt 通过。本机已补拷 hermes.exe 到 hermes\bin，探测实测通过
