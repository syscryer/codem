# Task: 修复 Grok 安装后检测不到

## Background

Grok 官方安装器会把命令默认写入 `~/.grok/bin`，并只更新 shell 配置；桌面应用已经运行时不会自动获得新的 PATH，导致安装成功后 CodeM 仍显示未检测到。

## Objective

让桌面版在 Grok 官方安装完成后立即发现 ~/.grok/bin、自定义安装目录及常见 PATH 目录中的 grok 命令，兼容 macOS 和 Windows。

## Scope

In scope:

- Grok 命令探测补充官方默认目录、自定义 `GROK_BIN_DIR` 和常见用户目录。
- 安装完成后的生命周期刷新立即复用新的命令探测逻辑。

Out of scope:

- 不修改 Grok 官方安装脚本。
- 不自动修改用户 shell 配置或系统 PATH。

## Impact

- 影响 Agent Provider 注册、安装完成后的诊断和后续 Grok ACP 启动；不影响普通聊天和其他 Agent。

## Acceptance Criteria

- [x] 默认检测 `~/.grok/bin/grok`。
- [x] 支持 `GROK_BIN_DIR`、`~/.local/bin`、`~/bin` 及 macOS 常见系统目录。
- [x] Windows 支持 `%LOCALAPPDATA%/Grok/grok.exe` 候选路径。
- [ ] Windows 实机安装后验证。

## Verification Commands

- `cargo check --features custom-protocol`
- `git diff --check`
- 桌面开发版 Rust 热重启及 `GET /api/runtime/identity`

## Implementation Record
- 2026-07-18T12:30:40.424Z 新增 Failed to connect/Couldn't connect 网络错误识别；Grok macOS 官方 bash 安装直连超时缩短为 30 秒，触发系统代理重试。

- 2026-07-18T12:12:16.587Z 安装/更新异常现在同时写入详情错误区并弹出 error toast，用户不会再看到成功提示后无从判断。
- 2026-07-18T12:10:39.330Z 后端安装流程在命令退出后强制验证可执行文件；未检测到时返回失败并附带清洗后的安装输出，避免 UI 显示假成功。

- 2026-07-18T12:02:59.191Z 补充修复：macOS Grok 安装命令启用 bash pipefail，避免 curl 下载失败被误报成功；前端根据后端 installed 与诊断结果区分真实安装成功。
- 2026-07-18T11:56:22.360Z 修复 Grok 安装后检测：解析 GROK_BIN_DIR，并扫描 ~/.grok/bin、~/.local/bin、~/bin、macOS 常见系统目录及 Windows LocalAppData/Grok。

- 2026-07-18T11:55:00.710Z Task created by Trellis automation.
- 2026-07-18：扩展 Grok 安装后命令探测候选路径，覆盖官方默认目录和自定义安装目录。

## Verification Results
- 2026-07-18T12:30:40.441Z `git diff --check`: pass

- 2026-07-18T12:30:40.435Z `GET /api/agents/settings-diagnostics?providerId=grok-build`: installed=true，command=/Users/mars/.grok/bin/grok
- 2026-07-18T12:30:40.430Z `cargo test --features custom-protocol agent_lifecycle_mirror_retry_requires_a_network_failure`: pass

- 2026-07-18T12:30:40.428Z `POST /api/agents/lifecycle grok-build install`: HTTP 200，networkPath=codem-proxy，installed=true，version=0.2.103
- 2026-07-18T12:12:23.256Z `git diff --check`: pass

- 2026-07-18T12:11:10.632Z `git diff --check`: pass
- 2026-07-18T12:11:10.629Z `node_modules/typescript/bin/tsc -b`: 未通过：仓库既有 src/lib/workbench-files.ts TS2742 类型错误，与本次修改无关

- 2026-07-18T12:10:49.203Z `cargo test --features custom-protocol grok_install_plan_fails_when_the_download_pipeline_fails`: pass
- 2026-07-18T12:10:49.199Z `cargo check --features custom-protocol`: pass（仅保留仓库既有 warning）

- 2026-07-18T12:02:59.199Z `agent-provider-management-ui.test.ts`: pass
- 2026-07-18T12:02:59.196Z `cargo check --features custom-protocol`: pass

- 2026-07-18T12:02:59.189Z `cargo test grok_install_plan_fails_when_the_download_pipeline_fails`: pass
- 2026-07-18T11:56:22.356Z `桌面版 Rust 热重启 + GET /api/runtime/identity`: pass

- `cargo check --features custom-protocol`：通过。
- `git diff --check`：通过。
- 桌面开发版已重新编译并运行，后端 `http://127.0.0.1:3001` 可响应。

## Completion Summary
- 2026-07-18T12:30:47.102Z Grok 直连连接失败现在 30 秒内切换系统代理；真实安装已完成并由 CodeM 检测到 /Users/mars/.grok/bin/grok 0.2.103。

- 2026-07-18T12:12:23.258Z 安装失败时同步显示右下角错误提示和详情错误信息，避免假成功体验。
- 2026-07-18T12:11:18.544Z Grok 安装命令成功后强制验证可执行文件；未检测到时返回可诊断失败摘要。已通过 cargo check、Grok 安装计划测试、Vite 构建和 diff 检查；TypeScript 全量检查仍受仓库既有 workbench-files.ts TS2742 阻塞。

- 2026-07-18T12:03:06.346Z 已修复 Grok 安装误报：macOS 下载管道启用 pipefail，curl 下载失败会进入失败/代理重试；前端仅在后端确认命令存在且诊断已安装时显示成功，否则明确提示命令完成但未检测到。
- 2026-07-18T11:56:32.927Z 已修复 Grok 官方安装完成后桌面版因 PATH 未刷新而检测不到的问题；命令探测现在覆盖官方默认目录、自定义 GROK_BIN_DIR、常见用户目录和 Windows LocalAppData 目录。桌面版已热重启验证。

## Follow-ups

- 待补充。
