# Task: Agent Mux 按需 Runtime 与 CLI

## Background

Agent Mux 已完成真实配置、调用、事件持久化和 Skill 导出，但导出的 Skill 仍依赖 CodeM 当前 Backend 地址。关闭桌面界面后，内嵌 Backend 随进程退出，外部 Agent 无法继续调用。用户确认采用“按需 Runtime + CLI”方案，使调用方式接近 RunMux，同时保留 CodeM 的可视化配置和监控。

## Objective

关闭 CodeM 后外部 Agent 仍可通过 codem-agent-mux Skill 发现配置、调用 Agent、监控和取消运行

## Scope

In scope:

- 新增 `codem-agent-mux` Rust CLI，提供 `ensure`、`agents`、`invoke`、`status`、`cancel`、`stop` 命令和 JSON 输出。
- 第一次 CLI 调用按需启动独立 Runtime；Runtime 使用当前用户 CodeM 数据目录、SQLite、渠道密钥存储和 Agent 运行实现。
- 使用用户目录下的 discovery 文件记录端口、PID、版本和随机 token；只监听 `127.0.0.1`，同一用户只保留一个有效 Runtime。
- Runtime API 启用 Bearer token；CLI 内部读取 token，导出的 Skill 不展示 token 或渠道密钥。
- CodeM 桌面优先复用已运行的 Runtime；没有 Runtime 时允许保持现有内嵌 Backend 作为兼容回退。
- 导出 Skill 改为调用 CLI，不再依赖固定或临时 HTTP 端口。
- Agent Hub 打开时轮询 SQLite 概览和选中运行事件，使外部调用可实时显示；运行中的外部调用可以取消。
- Windows 完成真实验收；路径、discovery 数据和 CLI 参数保持跨平台。

Out of scope:

- 开机自启、系统级 Windows Service、托盘常驻。
- 远程网络访问、多用户共享或跨机器调用。
- 多 Agent 工作流编排。
- 改造 Claude Code 独立通用运行协议。

## Impact

- Backend: Runtime token、discovery、关闭端点及现有 Agent/Agent Mux 路由复用。
- CLI: 新增 `src-tauri/src/bin/codem-agent-mux.rs`。
- Desktop: 后端启动时优先读取 Runtime discovery，并复用有效端口。
- Frontend: Skill 文本、Runtime 状态、外部运行轮询与取消。
- Packaging: 构建并携带 `codem-agent-mux` 可执行文件。

## Acceptance Criteria

- [x] 未运行 Runtime 时，`codem-agent-mux agents --json` 能自动启动并返回真实可用配置。
- [x] Runtime discovery 包含端口、PID、版本和 token，但 Skill、日志、SQLite 事件和命令输出不泄露 token/API Key。
- [x] `codem-agent-mux invoke` 能实时输出公开 Agent 文本，并将运行、事件和终态写入 Agent Mux SQLite。
- [x] 关闭 CodeM 后 CLI 调用仍成功；重开 CodeM 后能恢复并监控该调用。
- [x] CodeM 打开时能看到外部运行状态和输出，并能取消仍在运行的调用。
- [x] 同时执行多个 ensure 不会启动多个有效 Runtime；端口冲突时自动选择可用端口。
- [x] `stop` 后 Runtime 退出且 discovery 失效，下一次调用可以重新按需启动。
- [x] 类型检查、前端构建、Rust 检查/测试、CLI 集成测试和桌面页面验证通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux_runtime`
- CLI：`agents --json`、`invoke`、`status --json`、`cancel`、`stop`
- Playwright：外部运行实时监控、刷新恢复和取消。

## Implementation Record

- 2026-08-05T03:15:54.498Z Windows Runtime 改用 CreateProcessW 且 bInheritHandles=false；token 通过 Unicode environment block 传递，新增参数引用与环境块单测，修复首次 CLI 调用在 stdout 捕获环境中等不到 EOF 的问题。
- 2026-08-05T01:50:22.118Z 完成 Agent Mux Skill 页 Runtime 状态与停止入口；CLI 公开输出按批次写入 output 事件，并在流异常时回写 failed 终态。

- 2026-08-05T01:07:15.535Z Task created by Trellis automation.

## Verification Results
- 2026-08-05T03:16:53.852Z `并发 ensure 单实例`: 通过：并发首次 ensure 均返回同一个 Runtime PID；正式 CodeM 与 CodeM Dev 的独立数据目录按设计隔离。

- 2026-08-05T03:16:53.492Z `真实运行取消`: 通过：45 秒 Codex 任务进入 running 并取得 providerRunId；cancel 后最终保持 cancelled，存在 cancelled 事件且未输出 SHOULD_NOT_COMPLETE。
- 2026-08-05T03:16:53.119Z `真实 Codex invoke 与 SQLite 事件`: 通过：使用 codex-openai / gpt-5.6-sol 返回 AGENT_MUX_RUNTIME_OK；caller=External Skill，终态 completed，providerRunId 与 output 事件均已持久化。

- 2026-08-05T03:16:52.783Z `codem-agent-mux agents --json（Runtime 未运行）`: 通过：自动启动 Runtime PID 29308 / 端口 54247，返回 codex、claude、grok、pi 四类 Agent 和 2 个真实可用 profile。
- 2026-08-05T03:15:56.271Z `npm run package:doctor && npm run package:win`: 通过：Doctor OK；NSIS 与 MSI 生成成功，两个安装器均只包含一份 codem-agent-mux.exe（21001216 bytes）。

- 2026-08-05T03:15:55.886Z `npm typecheck/build；前端全量测试；cargo fmt/check/test`: 通过：类型检查与生产构建成功；前端源码全测通过；Rust library 424 passed、1 ignored；Runtime、鉴权和 Windows CLI 定向测试全部通过。
- 2026-08-05T03:15:55.522Z `Runtime status 脱敏检查`: 通过：CLI status 的 PID/端口与 discovery 一致，未包含精确 token、Bearer 文本、API Key 或 sk- 形式密钥。

- 2026-08-05T03:15:55.170Z `CodeM Dev Runtime 与桌面壳复用`: 通过：release Runtime PID 13540、端口 52556；桌面日志记录 reusing Agent Mux Runtime port: 52556，CodeM Dev Runtime 数量为 1。
- 2026-08-05T03:15:54.831Z `CLI 首次 ensure + stdout/stderr 重定向 + stop`: 通过：CLI 8 秒内退出，输出流 3 秒内收到 EOF；Runtime 在 CLI 退出后保持运行，stop 后进程退出且 discovery 删除。

## Completion Summary
- 2026-08-05T03:17:30.752Z 完成 Agent Mux 按需 Runtime 与 CLI 闭环：CodeM 关闭后可自动启动独立 Runtime 并发现、调用、监控、取消 Agent；桌面重开复用同一 Runtime；Bearer token 仅保存在 discovery 与进程环境；修复 Windows 输出管道继承；NSIS/MSI 均携带单份 CLI；全量前端、Rust、真实调用/取消、单实例和打包验收通过。

## Follow-ups

- macOS/Linux 安装包中的 sidecar 真实发布验证。
- 可选开机自启与 Runtime 自动更新。
