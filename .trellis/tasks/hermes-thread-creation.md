# Task: 修复 Hermes 新建会话

## Background

Hermes CLI 已被 Provider Registry 识别为可用且可选择，但从项目新建 Hermes 会话时，线程创建接口仍返回“当前 Provider 不可用于新建聊天”。真实浏览器网络记录确认失败发生在 `POST /api/projects/{projectId}/threads`，不是渠道认证、模型请求或前端缓存问题。

## Objective

统一 Hermes Provider 注册状态与新建线程校验，使浏览器和桌面端可创建 Hermes 会话

## Scope

In scope:

- 统一 Hermes Provider Registry 与线程创建校验的 Provider 白名单。
- 补充 Hermes CLI 不可用和可用两条线程 Provider 回归测试。
- 重新构建、重启并使用真实浏览器验证 Hermes 新会话与首轮运行。

Out of scope:

- 不调整 Hermes 渠道认证、模型目录和 Driver 协议。
- 不修改聊天输入框及其自适应布局。
- 不处理 Hermes 模型目录接口当前返回 400 的独立问题。

## Impact

- `src-tauri/src/backend.rs` 的新建线程 Provider 解析。
- Hermes 新会话入口，不改变其他 Provider 行为。

## Acceptance Criteria

- [x] Hermes CLI 不可用时，新建线程返回明确的 Hermes CLI 缺失错误。
- [x] Hermes CLI 可用时，线程创建接受 `hermes-agent` Provider。
- [x] 真实浏览器可选择 Hermes Agent 和自定义渠道，并成功创建线程。
- [x] 首轮 Hermes Agent 运行返回成功且在聊天中显示响应。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml thread_provider_defaults_to_claude_and_requires_installed_agents --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml hermes --lib`
- `npm run typecheck`
- `npm run build`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `git diff --check`
- Playwright：新建项目聊天，选择 Hermes Agent 与 `Hermes MiniMax E2E`，发送 `请只回复 BROWSER_HERMES_OK`。

## Implementation Record

- 2026-08-10T06:17:49.686Z 修复 resolve_requested_thread_provider：将 hermes-agent 纳入共享线程创建白名单，并在 CLI 不可用时返回明确的 Hermes CLI 缺失错误；补充可用/不可用回归断言。
- 2026-08-10T06:02:06.802Z 浏览器真实发送复现：GET /api/agents/providers 返回 Hermes 可用，但 POST /api/projects/{id}/threads 返回 400。定位到 resolve_requested_thread_provider 白名单漏掉 HERMES_AGENT_PROVIDER_ID；非渠道或缓存问题。

- 2026-08-10T05:59:17.476Z Task created by Trellis automation.

## Verification Results

- 2026-08-10T06:18:19.012Z `Playwright 真实浏览器：新建 codem 项目聊天，选择 Hermes Agent 与 Hermes MiniMax E2E，发送 BROWSER_HERMES_OK`: POST /threads 200，POST /api/agents/run 200，页面显示 BROWSER_HERMES_OK；原 Provider 不可用错误已消失。
- 2026-08-10T06:18:09.800Z `cargo fmt --check；线程 Provider 回归；Hermes Rust 测试；npm typecheck/build；Agent onboarding 门禁；git diff --check`: 全部通过：线程 Provider 1/1，Hermes 13/13；TypeScript、Vite 构建、格式和接入门禁均通过。

## Completion Summary
- 2026-08-10T06:18:27.680Z Hermes 新建会话已修复：Registry 与线程创建校验一致，CLI 缺失错误明确，自动化门禁及真实浏览器首轮对话均通过。

## Follow-ups

- 待补充。
