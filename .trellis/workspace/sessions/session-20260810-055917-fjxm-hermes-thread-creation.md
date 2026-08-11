# Session Record: 修复 Hermes 新建会话

- Session: session-20260810-055917-fjxm
- Started: 2026-08-10T05:59:17.474Z
- Task: .trellis/tasks/hermes-thread-creation.md

## Notes

- 2026-08-10T06:17:49.686Z 修复 resolve_requested_thread_provider：将 hermes-agent 纳入共享线程创建白名单，并在 CLI 不可用时返回明确的 Hermes CLI 缺失错误；补充可用/不可用回归断言。
- 2026-08-10T06:02:06.802Z 浏览器真实发送复现：GET /api/agents/providers 返回 Hermes 可用，但 POST /api/projects/{id}/threads 返回 400。定位到 resolve_requested_thread_provider 白名单漏掉 HERMES_AGENT_PROVIDER_ID；非渠道或缓存问题。

- 2026-08-10T05:59:17.478Z Session started.

## Verification

- 2026-08-10T06:18:19.012Z `Playwright 真实浏览器：新建 codem 项目聊天，选择 Hermes Agent 与 Hermes MiniMax E2E，发送 BROWSER_HERMES_OK`: POST /threads 200，POST /api/agents/run 200，页面显示 BROWSER_HERMES_OK；原 Provider 不可用错误已消失。
- 2026-08-10T06:18:09.800Z `cargo fmt --check；线程 Provider 回归；Hermes Rust 测试；npm typecheck/build；Agent onboarding 门禁；git diff --check`: 全部通过：线程 Provider 1/1，Hermes 13/13；TypeScript、Vite 构建、格式和接入门禁均通过。

## Completed

- 2026-08-10T06:18:27.680Z Hermes 新建会话已修复：Registry 与线程创建校验一致，CLI 缺失错误明确，自动化门禁及真实浏览器首轮对话均通过。
