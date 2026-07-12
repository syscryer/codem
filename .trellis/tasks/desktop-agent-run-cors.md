# Task: 修复桌面端 Grok 请求 CORS

## Background

Grok Build 在 Web 开发模式下可以正常运行，但 Tauri 桌面开发壳提交消息时连续显示
`Failed to fetch`。桌面壳会把相对 API 请求改写到独立 Rust 后端端口，因此 JSON POST
会触发浏览器 CORS 预检。实际请求确认 `/api/agents/providers` 正常返回 CORS 响应头，
而 `/api/agents/run` 的预检返回 405；原因是 Agent 子路由在 CORS layer 挂载之后才合并。

## Objective

让 Tauri 桌面端能够通过 Rust Agent API 启动 Grok 流式运行，并覆盖 CORS 预检回归

## Scope

In scope:

- 让统一 CORS layer 覆盖 Rust 主路由和 Agent Run 子路由。
- 增加 `/api/agents/run` 桌面来源预检的 Rust 回归测试。
- 重启桌面开发服务并验证真实 Grok 流式请求。

Out of scope:

- 不调整 Grok ACP 协议、权限模式、Provider Registry 或 Claude 运行链路。
- 不扩大后端允许的来源范围。

## Impact

- Backend：`src-tauri/src/backend.rs` Router 中间件顺序。
- Test dependency：仅为 Router 行为测试使用 Tower service helper。
- Desktop：Tauri WebView 到本地 Rust Agent API 的 POST/DELETE 与控制请求恢复可用。

## Acceptance Criteria

- [x] `OPTIONS /api/agents/run` 对允许的本地桌面来源返回成功状态与 CORS 响应头。
- [x] Agent 子路由仍保持现有 API、流式事件和权限行为不变。
- [x] Rust 回归测试、格式检查与现有 Agent 测试通过。
- [ ] 桌面开发壳中的 Grok 请求不再显示 `Failed to fetch`，能够收到终态事件。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_run_preflight_includes_desktop_cors_headers`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- 桌面开发壳真实发送一条 Grok 消息，确认流式运行完成。

## Implementation Record
- 2026-07-12T12:26:24.003Z 确认桌面端失败根因：Agent Run 子路由在 CORS layer 之后合并，导致 /api/agents/run 预检返回 405。已将所有路由合并后统一挂载 CORS，并增加 Router 级预检回归测试。

- 2026-07-12T12:24:45.287Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T12:31:41.932Z `desktop agent API preflight and streamed Grok smoke`: 通过：3002 上 OPTIONS /api/agents/run 返回 200 与允许来源；真实 Grok 请求返回 delta 事件和 done(end_turn)，结果 DESKTOP_CORS_OK。

- 2026-07-12T12:31:41.518Z `npm.cmd run typecheck`: 通过：TypeScript 项目引用检查无错误。
- 2026-07-12T12:31:41.106Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust 格式检查无差异。

- 2026-07-12T12:31:40.686Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 38 项通过，1 项需要真实认证环境的 smoke test 按设计忽略。
- 2026-07-12T12:31:40.285Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run_preflight_includes_desktop_cors_headers`: 通过：1 项定向 Router CORS 预检测试通过。

## Completion Summary
- 2026-07-12T12:47:54.429Z 修复 Agent 子路由未继承 CORS 的问题，补充 Router 预检回归测试；Rust 38 项、格式、TypeScript 与真实 Grok 流式 API 验证通过。浏览器会话中的最终点击发送留作手工验收。

## Follow-ups

- 已通过桌面后端真实 Grok 流式请求验证 `delta` 与 `done`；用户切换到 Codex 接入任务前，未在浏览器会话中点击发送，保留一次 UI 手工验收。
