# Session Record: 接入 OpenAI Codex App Server

- Session: session-20260712-124801-cqg0
- Started: 2026-07-12T12:48:01.632Z
- Task: .trellis/tasks/codex-app-server-integration.md

## Notes
- 2026-07-12T13:29:30.537Z 前端将 openai-codex 路由到 generic Agent runtime；Provider 设置增加显式 Codex probe，Composer 名称/图标/纯文本限制/权限锁定跟随当前 Provider，Codex thread id 与三档权限写入现有线程元数据。

- 2026-07-12T13:29:30.084Z 完成 OpenAI Codex app-server stdio JSONL 驱动：支持 initialize/initialized、account/read、thread start/resume、turn start/interrupt、文本/工具/审批/用户提问/终态映射；增加输出脱敏、大小限制、探测超时和子进程关闭。通用 Agent Run 保持 Grok ACP 行为，Claude 专用 API/hook 未改。
- 2026-07-12T12:54:57.995Z 设计确认：Codex 使用官方 app-server stdio JSONL；首版每个 CodeM run 启动一个进程，成功 thread/start 或 thread/resume 后才持久化 thread id；通用控制命令从 ACP 命名中解耦；default/auto/bypassPermissions 分别映射 untrusted+workspaceWrite、on-request+workspaceWrite、never+dangerFullAccess。当前机器仅有不可由普通进程启动的 Windows Store codex.exe，真实协议以 mock 覆盖并保留 CODEX_CLI_PATH。

- 2026-07-12T12:48:01.634Z Session started.

## Verification

- 2026-07-12T13:35:37.791Z `POST http://127.0.0.1:3002/api/agents/codex/probe`: pass: installed=false initialized=false on protected Windows Store-only installation; Claude and Grok remain available
- 2026-07-12T13:35:37.339Z `browser smoke at http://127.0.0.1:5173`: pass: Codex visible in Provider menu, disabled when CLI unavailable; settings probe shows recovery guidance; no page console errors

- 2026-07-12T13:29:33.221Z `node --import tsx --test src/lib/*.test.ts`: task-related pass; 3 pre-existing unrelated assertions remain: macOS private API feature, desktop managed-backend cleanup, basic settings Git review grouping
- 2026-07-12T13:29:32.780Z `npm.cmd run build`: pass; existing Vite dynamic/static import warnings only

- 2026-07-12T13:29:32.340Z `node --import tsx --test focused Codex/Provider/Agent/Claude regression suite`: pass: 73/73
- 2026-07-12T13:29:31.899Z `npm.cmd run typecheck`: pass

- 2026-07-12T13:29:31.442Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass
- 2026-07-12T13:29:30.993Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass: 37 library tests + 9 desktop tests; 1 authenticated Grok smoke ignored

## Completed

- 2026-07-12T13:35:38.241Z 已接入 OpenAI Codex app-server：完成 CLI 探测、线程创建/恢复、文本与工具流、审批/提问、取消、三档权限、线程元数据和 Provider UI；Claude 专用链路保持不变。Rust 全测、前端聚焦回归、类型检查、生产构建和浏览器 smoke 通过；当前机器无可启动的独立 Codex CLI，因此真实账号 smoke 由协议 mock 覆盖。
