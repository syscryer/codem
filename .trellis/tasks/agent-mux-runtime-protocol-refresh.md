# Task: Agent Mux Runtime 协议刷新

## Background

桌面开发模式启动时会构建最新的 `codem-agent-mux` CLI，但桌面壳当前只要 discovery 指向的 Runtime 能返回通用 Rust identity，就会继续复用旧进程。2026-08-05 现场中，11:16 启动的旧 Runtime 不包含随后加入的 `/api/agent-mux/skill-source`，13:38 重启桌面后仍被复用，导致 Agent Mux Skill 页面稳定显示 404、识别与安装状态为 0。

## Objective

旧 Runtime 接口落后时自动安全重启，消除 Skill 页 404

## Scope

In scope:

- 为 Runtime discovery 和 identity 增加显式协议版本。
- 桌面壳与 CLI 只复用协议匹配且 identity 校验通过的 Runtime。
- 发现旧协议 Runtime 时，使用 discovery token 请求其关闭端点，等待退出后清理旧 discovery，再由当前 CLI 启动新 Runtime。
- 兼容读取没有协议版本的旧 discovery，并将其视为需要刷新。
- 重启当前桌面开发链路，验证 Skill 源接口和页面状态恢复。

Out of scope:

- 不改变 Agent Mux 配置、运行记录、Skill 内容或安装目标目录。
- 不增加常驻服务、开机自启或远程访问。
- 不因为刷新 Runtime 而终止协议兼容且仍可用的进程。

## Impact

- Backend/CLI/Desktop: `src-tauri/src/agent_mux_runtime.rs`、`src-tauri/src/backend.rs`、`src-tauri/src/bin/codem-agent-mux.rs`、`src-tauri/src/main.rs`。
- Runtime state: `%LOCALAPPDATA%/CodeM Dev/agent-mux-runtime.json` 增加非敏感协议版本字段。
- Security/privacy: 关闭请求继续使用现有 Bearer token；公开状态仍不得暴露 token 或渠道密钥。

## Acceptance Criteria

- [x] 旧 discovery（缺少协议版本）可以被读取，但不会被误判为兼容 Runtime。
- [x] identity 同时验证 `app=codem`、`backend=rust` 和当前 Runtime 协议版本。
- [x] 桌面或 CLI 遇到旧 Runtime 时会请求关闭并启动当前构建，避免遗留同一数据目录的孤立旧进程。
- [x] 当前协议 Runtime 继续复用，关闭 CodeM 后独立 Runtime 仍保持运行。
- [x] Agent Mux Skill 页 `/api/agent-mux/skill-source` 返回 200，真实识别与安装状态恢复，不再显示 404。
- [x] Rust 定向测试、格式、前端类型/构建和桌面真实链路验证通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux_runtime`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- `npm run build`
- `npm run desktop:dev` 后验证 Runtime discovery、identity、Skill source 和桌面页面。

## Implementation Record
- 2026-08-05T05:51:45.822Z 已实现 Runtime 协议版本与 identity 校验；旧 discovery 保持可读但不再复用，CLI/桌面在刷新前使用 token 请求旧 Runtime 正常关闭。

- 2026-08-05T05:48:28.861Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T06:02:26.796Z `桌面开发 Runtime 真实刷新与 Agent Mux Skill API`: PASS：旧 PID 29308 正常退出；新 PID 52892/协议 1；identity=codem/rust/1；skill-source=200；5 个 Agent 目标均 installed；CLI 返回 2 个可用配置；桌面窗口唯一且响应正常。
- 2026-08-05T06:02:26.012Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: PASS：Rust 格式与 diff whitespace 检查通过。

- 2026-08-05T06:02:25.255Z `npm run typecheck && npm run build`: PASS：TypeScript 类型检查和 Vite 生产构建成功，仅有既有 chunk 提示。
- 2026-08-05T06:02:24.505Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux_runtime -- --nocapture`: PASS：4 个 Runtime 定向测试通过，覆盖旧 discovery、协议 identity 与 token 脱敏。

## Completion Summary
- 2026-08-05T06:03:02.710Z 修复 Agent Mux Skill 页 404：Runtime discovery/identity 增加协议版本，桌面和 CLI 自动关闭并刷新旧 Runtime；旧进程已替换为当前协议 Runtime，Skill source 返回 200，5 个 Agent 目标均识别且已安装，2 个真实配置可调用。

## Follow-ups

- 发布版本升级时继续按兼容性变化递增 Runtime 协议版本；纯内部实现调整无需递增。
