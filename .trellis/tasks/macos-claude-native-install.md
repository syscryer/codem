# Task: 修复 macOS Claude 一键安装

## Background

macOS 桌面应用从 Finder/Tauri 启动时不会读取用户的登录 shell 配置，进程 PATH 往往不包含 nvm、Volta、Homebrew 或其他 Node.js 安装目录。当前 Claude Code 一键安装固定通过裸 `npm install -g @anthropic-ai/claude-code` 执行，`tokio::process::Command` 无法找到 `npm` 时会直接返回 `No such file or directory (os error 2)`。Windows 当前安装链路正常，不应随本次修复改变。

## Objective

macOS 桌面环境无需 npm PATH 即可通过官方原生安装器安装 Claude Code，并在安装后被现有诊断稳定发现

## Scope

In scope:

- macOS 上 Claude Code 一键安装改用 Claude 官方原生安装脚本。
- 安装进程使用系统绝对路径启动 shell 和 curl/bash，避免再次依赖 GUI PATH。
- Claude 安装与更新优先继承进程显式代理；未设置时只读解析 macOS 系统 HTTP/HTTPS/SOCKS 代理并注入子进程。
- 安装后继续复用现有 `~/.local/bin/claude` 命令发现、版本读取和 `claude update` 更新链路。
- 补充生命周期计划的跨平台回归测试，确保 Windows 仍使用现有 npm 安装方式。

Out of scope:

- 不修改系统或用户 PATH，不读取或执行用户 shell 初始化文件。
- 不保存、展示或修改系统代理，不接受前端任意代理地址。
- 不使用未经验证的第三方 Claude 二进制镜像，继续保留官方 manifest 与 SHA-256 校验链路。
- 不改变 Windows Claude 安装行为。
- 不改变 Codex、OpenCode、Grok Build 的安装方式。
- 不接管 Claude 凭据、认证或配置。

## Impact

- Backend: `src-tauri/src/backend.rs` Agent 生命周期安装计划与单元测试。
- Frontend/API: 不改变字段或交互 contract，仅让现有安装动作在 macOS 可执行。

## Acceptance Criteria

- [x] macOS Claude 安装计划不再依赖 `npm`，而是调用 `https://claude.ai/install.sh` 官方原生安装器。
- [x] macOS 安装计划使用 `/bin/sh`、`/usr/bin/curl` 与 `/bin/bash` 绝对路径。
- [x] Agent 设置诊断与 Claude 版本接口在 macOS 均显示官方安装命令；未安装状态的更新命令显示 `claude update`，不再残留 npm 文案。
- [x] macOS Claude 生命周期在显式代理存在时保持显式代理优先；否则继承系统代理（包括常见的 `127.0.0.1:7890`）。
- [x] 系统代理读取失败、未启用或字段非法时不注入代理，安装仍按原有官方直连流程执行。
- [x] 不新增代理 API 字段，不保存或主动记录代理地址；生命周期响应结构保持不变。
- [x] 官方原生安装完成后，现有 `~/.local/bin/claude` fallback 可以被诊断和 Provider Registry 发现。
- [x] Windows Claude 安装计划仍为 `npm.cmd install -g @anthropic-ai/claude-code@latest`。
- [x] 其他 Agent 生命周期计划与 npm 镜像重试判断不变。
- [x] Rust 定向测试、全量测试、格式检查和差异检查通过，桌面开发服务重启后诊断接口正常。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle`
- `cargo test --manifest-path src-tauri/Cargo.toml default_claude_command_paths`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml proxy`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- 运行中的 macOS 后端：`GET /api/agents/settings-diagnostics?providerId=claude-code` 返回官方原生安装命令。

## Implementation Record

- 2026-07-17T09:57:48.239Z 补充国内网络适配：macOS Claude 安装/更新在进程未显式配置代理时，通过 /usr/sbin/scutil --proxy 只读解析系统 HTTP/HTTPS/SOCKS 代理并注入子进程；显式 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 保持最高优先级。继续使用 Claude 官方下载源、manifest 和 SHA-256 校验，不保存或修改代理配置。
- 2026-07-17T08:06:48.203Z 补齐 macOS 命令展示一致性：Agent 设置诊断与 Claude version-info 均返回官方原生安装命令；未安装状态更新提示改为 claude update，避免页面底部继续显示不可用 npm。新增真实可执行 ~/.local/bin/claude PATH 外发现测试。

- 2026-07-17T07:42:55.174Z 实现 macOS Claude 原生安装计划：/bin/sh 调用 /usr/bin/curl 获取 https://claude.ai/install.sh 并交给 /bin/bash；现有 ~/.local/bin/claude 探测和原生 claude update 更新链路保持不变，Windows npm 计划由回归测试锁定。
- 2026-07-17T07:12:39.818Z 确认根因：macOS Tauri GUI 进程未继承登录 shell PATH，Claude 安装计划直接启动裸 npm 导致 os error 2；官方 https://claude.ai/install.sh 可访问，修复限定为 macOS Claude 原生安装，Windows 与其他 Agent 保持不变。

- 2026-07-17T07:09:46.373Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T09:57:48.303Z `macOS 系统代理与最新桌面二进制核验`: 通过：scutil 返回 HTTP/HTTPS/SOCKS 127.0.0.1:7890；最新桌面二进制在未显式传入代理环境的方式下已启动；安装/更新命令仍为官方原生链路；cargo fmt --check 与 git diff --check 通过。未执行实际 Claude 安装。
- 2026-07-17T09:57:48.283Z `PATH=<bundled-node> cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 153 passed、0 failed、1 ignored；desktop main 9 passed；代理与既有 Agent 生命周期回归均通过。

- 2026-07-17T09:57:48.262Z `cargo test --manifest-path src-tauri/Cargo.toml proxy -- --nocapture`: 通过：3/3，覆盖 HTTP/HTTPS/SOCKS 系统代理解析、禁用/非法字段忽略、显式代理优先和系统代理 fallback 注入。
- 2026-07-17T08:06:48.264Z `最终桌面二进制与 API 核验`: 通过：最新桌面二进制已启动；settings-diagnostics install=/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash、update=claude update；claude/version-info 返回相同命令；cargo fmt --check、git diff --check 通过。

- 2026-07-17T08:06:48.240Z `PATH=<bundled-node> cargo test --manifest-path src-tauri/Cargo.toml（最终）`: 通过：Rust lib 150 passed、0 failed、1 ignored；desktop main 9 passed；覆盖 macOS 原生安装、未安装更新展示、Windows npm 保持、PATH 外 ~/.local/bin/claude 可执行发现。
- 2026-07-17T07:42:55.241Z `macOS 桌面重启；GET /api/agents/settings-diagnostics?providerId=claude-code；本地 Agent 设置页核验`: 通过：桌面后端监听 127.0.0.1:3001，Web 监听 127.0.0.1:5173；installCommand 为 /usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash；页面安装命令同步显示，控制台 0 error/0 warning。未执行实际安装。

- 2026-07-17T07:42:55.220Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check`: 通过：Rust 格式与差异检查无错误。
- 2026-07-17T07:42:55.198Z `PATH=<bundled-node> cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 148 passed、0 failed、1 ignored；desktop main 9 passed；新增 macOS/Windows Claude 安装计划测试均通过。测试时临时启用仓库 macOS Tauri 私有 API feature，验证后已恢复 Cargo.toml。

## Completion Summary

- 2026-07-17T09:58:37.220Z 完善 macOS Claude 国内网络可用性：官方原生安装与更新子进程优先继承显式代理，否则自动读取 macOS 系统 HTTP/HTTPS/SOCKS 代理（本机 127.0.0.1:7890）；不修改或持久化代理，不引入第三方二进制镜像，官方 manifest 与 SHA-256 校验链路保持。Rust 全量 153/153（另 1 ignored）、桌面 main 9/9 通过，最新桌面二进制已启动。
- 2026-07-17T08:08:20.308Z 修复 macOS Claude Code 一键安装：改用官方原生安装器并消除 npm PATH 依赖，统一 Agent 设置与版本接口的安装/更新命令展示，验证 PATH 外 ~/.local/bin/claude 可发现；Windows npm 行为保持不变。Rust 全量 150/150（另 1 ignored）与桌面 main 9/9 通过，最新桌面二进制已启动。

## Follow-ups

- 后续可单独评估 macOS 上 Codex/OpenCode 在无 npm 环境下的安装引导，不纳入本次 Claude 定向修复。
