# Task: Windows Claude 安装回退到原生安装器

## Background

Windows 上 Claude Code 一键安装当前固定选择 npm、pnpm 或 bun。新机器没有 Node.js/包管理器时，生命周期计划会在联网前直接返回“未检测到 npm、pnpm 或 bun”，因此已有的 CodeM 代理、系统代理和官方原生安装能力都无法参与。macOS 已使用 Claude 官方原生安装器，并已具备代理回退、原生命令发现和 `claude update` 更新链路。

## Objective

Windows 未检测到 npm、pnpm 或 bun 时使用 Claude 官方原生安装器；包管理器存在时保持优先，并复用 CodeM 代理、系统代理和 npm 国内镜像链路

## Scope

In scope:

- Windows 安装 Claude Code 时继续优先选择 npm、pnpm、bun，保持现有优先级。
- Windows 未检测到受支持包管理器时，回退到 Claude 官方 PowerShell 原生安装器。
- 原生安装复用现有直连、CodeM 代理和系统代理重试链路。
- 安装命令展示、安装后 `~/.local/bin/claude.exe` 发现和原生 `claude update` 保持一致。
- 补充跨平台生命周期计划回归测试，锁定包管理器优先和无包管理器时的原生回退。

Out of scope:

- 不内置 Node.js，不自动修改系统或用户 PATH。
- 不使用第三方 Claude 二进制镜像，不绕过官方安装器的完整性校验。
- 不在包管理器安装失败后静默切换安装来源。
- 不改变 macOS、Linux 或其他 Agent 的安装策略。
- 不改变聊天请求、Claude 凭据和渠道配置。

## Impact

- Backend: `src-tauri/src/backend.rs` Claude 生命周期安装计划、命令展示与单元测试。
- Frontend/API: 不新增字段，不改变现有安装交互和响应 contract。

## Acceptance Criteria

- [x] Windows 检测到 npm 时继续使用 npm 安装 Claude Code。
- [x] Windows npm 不可用但 pnpm 或 bun 可用时，继续按既有优先级使用对应包管理器。
- [x] Windows 没有 npm、pnpm、bun 时使用 `https://claude.ai/install.ps1` 官方原生安装器，不再返回 Node.js 前置错误。
- [x] Windows 原生安装计划可进入现有 CodeM/系统代理重试路径，且不被 npm 国内镜像判断误识别。
- [x] 安装诊断展示与实际执行命令一致；原生安装后现有 `~/.local/bin/claude.exe` 可发现并使用 `claude update`。
- [x] macOS Claude 原生安装和其他 Agent 生命周期行为保持不变。
- [x] Rust 定向测试、全量测试、格式检查和差异检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_command`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-26T03:27:33.756Z 为新机器 CLI 持久化当前系统代理对应的 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890，并设置 NO_PROXY=localhost,127.0.0.1,::1，避免 rustup 下载卡住及本地测试被代理转发。

- 2026-07-26T03:26:11.041Z 新机器开发环境已安装 Git 2.55.0、Node.js 24.18.0/npm 11.16.0、Rust stable 1.97.1 MSVC、Visual Studio 2022 C++ Build Tools/Windows SDK；CurrentUser PowerShell 执行策略设为 RemoteSigned，仓库加入 Git safe.directory。补齐 backend.rs rustfmt 格式并开始完整验证。
- 2026-07-26T02:49:46.523Z 已实现 Windows Claude 安装计划选择：依次探测 npm、pnpm、bun，均不可用时回退官方 install.ps1；原生 PowerShell 执行脚本将 CodeM/系统 HTTP(S) 代理设置为 .NET 默认代理，安装来源更新逻辑和 npm 镜像判断保持不变。

- 2026-07-26T02:43:54.293Z Task created by Trellis automation.

## Verification Results

- 2026-07-26T03:26:41.158Z `git diff --check`: 通过：无空白错误，仅有工作区既有 LF/CRLF 提示。
- 2026-07-26T03:26:40.173Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust library 195 passed、0 failed、1 ignored；desktop main 13 passed；doc tests 通过。首次运行因 PATH/NO_PROXY 缺失有 2 个环境失败，补齐进程环境后全量通过。

- 2026-07-26T03:26:39.154Z `cargo test agent_lifecycle；cargo test windows_claude_install；cargo test claude_command`: 通过：Agent 生命周期 9/9，Windows Claude 包管理器优先与原生回退 2/2，Claude 命令发现 2/2。
- 2026-07-26T03:26:38.160Z `rustfmt --edition 2021 --check src-tauri/src/backend.rs`: 通过。本次 backend.rs 符合 rustfmt；仓库级 cargo fmt --check 仍会报告用户未完成的 agent_channels.rs、automation.rs 格式差异，未改动这些文件。

- 2026-07-26T03:26:37.138Z `npm run package:doctor`: 通过：Doctor: OK；Node.js 24.18.0、npm 11.16.0、Rust/Cargo、Tauri CLI 均可用。
- 2026-07-26T02:57:14.517Z `cargo fmt/test`: 未执行：当前 Windows 环境未安装 Rust/Cargo 与 C++ 构建工具链；已补充定向单元测试代码，需在已有 Rust 工具链或 CI 中运行。

- 2026-07-26T02:57:13.987Z `git diff --check`: 通过：无空白错误；仅输出工作区既有 LF/CRLF 提示。
- 2026-07-26T02:57:13.437Z `Windows PowerShell Parser + 代理凭据投影测试`: 通过：install.ps1 包装脚本语法有效；HTTPS_PROXY 的主机、端口与 URL 编码认证信息正确写入 WebProxy，代理地址不保留用户信息。

## Completion Summary

- 2026-07-26T03:27:34.067Z 新机器 CodeM Windows 开发环境安装完成：Git、Node/npm、Rust stable MSVC、VS 2022 C++ Build Tools、Windows SDK、WebView2 和 Tauri CLI 均可用；PowerShell、Git safe.directory 与 CLI 代理已配置。Windows Claude 原生安装回退实现通过 backend rustfmt、定向测试和 Rust 全量 195+13 测试。
- 2026-07-26T02:57:53.851Z Windows Claude 安装现按 npm、pnpm、bun 顺序优先选择包管理器，全部不可用时回退官方 install.ps1；原生 PowerShell 路径接入 CodeM/系统 HTTP(S) 代理并保持原生更新与命令发现。已通过 PowerShell 语法/代理投影检查和 git diff --check；当前机器无 Rust/Cargo，定向与全量 Rust 测试留待有工具链环境或 CI 执行。

## Follow-ups

- Windows PowerShell 官方安装器经 CodeM 自定义 HTTP/HTTPS/SOCKS5 代理的实机行为需要在可用代理环境中验收。
