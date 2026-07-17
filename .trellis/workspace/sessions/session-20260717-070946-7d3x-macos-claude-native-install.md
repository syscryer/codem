# Session Record: 修复 macOS Claude 一键安装

- Session: session-20260717-070946-7d3x
- Started: 2026-07-17T07:09:46.372Z
- Task: .trellis/tasks/macos-claude-native-install.md

## Notes
- 2026-07-17T08:06:48.203Z 补齐 macOS 命令展示一致性：Agent 设置诊断与 Claude version-info 均返回官方原生安装命令；未安装状态更新提示改为 claude update，避免页面底部继续显示不可用 npm。新增真实可执行 ~/.local/bin/claude PATH 外发现测试。

- 2026-07-17T07:42:55.174Z 实现 macOS Claude 原生安装计划：/bin/sh 调用 /usr/bin/curl 获取 https://claude.ai/install.sh 并交给 /bin/bash；现有 ~/.local/bin/claude 探测和原生 claude update 更新链路保持不变，Windows npm 计划由回归测试锁定。
- 2026-07-17T07:12:39.818Z 确认根因：macOS Tauri GUI 进程未继承登录 shell PATH，Claude 安装计划直接启动裸 npm 导致 os error 2；官方 https://claude.ai/install.sh 可访问，修复限定为 macOS Claude 原生安装，Windows 与其他 Agent 保持不变。

- 2026-07-17T07:09:46.373Z Session started.

## Verification
- 2026-07-17T08:06:48.264Z `最终桌面二进制与 API 核验`: 通过：最新桌面二进制已启动；settings-diagnostics install=/usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash、update=claude update；claude/version-info 返回相同命令；cargo fmt --check、git diff --check 通过。

- 2026-07-17T08:06:48.240Z `PATH=<bundled-node> cargo test --manifest-path src-tauri/Cargo.toml（最终）`: 通过：Rust lib 150 passed、0 failed、1 ignored；desktop main 9 passed；覆盖 macOS 原生安装、未安装更新展示、Windows npm 保持、PATH 外 ~/.local/bin/claude 可执行发现。
- 2026-07-17T07:42:55.241Z `macOS 桌面重启；GET /api/agents/settings-diagnostics?providerId=claude-code；本地 Agent 设置页核验`: 通过：桌面后端监听 127.0.0.1:3001，Web 监听 127.0.0.1:5173；installCommand 为 /usr/bin/curl -fsSL https://claude.ai/install.sh | /bin/bash；页面安装命令同步显示，控制台 0 error/0 warning。未执行实际安装。

- 2026-07-17T07:42:55.220Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check`: 通过：Rust 格式与差异检查无错误。
- 2026-07-17T07:42:55.198Z `PATH=<bundled-node> cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 148 passed、0 failed、1 ignored；desktop main 9 passed；新增 macOS/Windows Claude 安装计划测试均通过。测试时临时启用仓库 macOS Tauri 私有 API feature，验证后已恢复 Cargo.toml。

## Completed

- 2026-07-17T08:08:20.308Z 修复 macOS Claude Code 一键安装：改用官方原生安装器并消除 npm PATH 依赖，统一 Agent 设置与版本接口的安装/更新命令展示，验证 PATH 外 ~/.local/bin/claude 可发现；Windows npm 行为保持不变。Rust 全量 150/150（另 1 ignored）与桌面 main 9/9 通过，最新桌面二进制已启动。
