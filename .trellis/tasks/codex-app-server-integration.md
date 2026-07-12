# Task: 接入 OpenAI Codex App Server

## Background

CodeM 已完成 Provider Registry、通用 Agent Run API、Provider 归属持久化和 Grok ACP
接入，但通用链路仍在多个位置写死 `grok-build`。OpenAI 官方为富客户端提供
`codex app-server`，其默认 stdio 传输使用 JSONL JSON-RPC，支持线程创建/恢复、流式
item 事件、审批、用户提问和中断。Codex 已在 Registry 中以 `codex-json-rpc` 占位，
本任务将其接入主聊天，同时保持 Claude 专用链路不变。

## Objective

在不改变 Claude 现有链路的前提下，让 CodeM 支持 Codex CLI 探测、主聊天文本流、续聊、取消、工具与交互事件及三档权限

## Scope

In scope:

- 发现可由普通子进程启动的 Codex CLI，支持 `CODEX_CLI_PATH` 显式覆盖。
- 通过 `codex app-server` stdio 完成 `initialize`、`thread/start|resume`、`turn/start` 和
  `turn/interrupt` 生命周期。
- 将 Codex 文本、工具、完成、失败、审批和用户提问映射到现有 `AgentRunEvent`。
- 复用 `/api/agents/run`、取消、审批和用户输入控制端点，不新增第二套聊天 API。
- 让 Codex 可从新聊天 Provider 选择器进入，并持久化 provider、sessionId 与三档权限。
- 三档权限仅使用 CodeM 的 `default`、`auto`、`bypassPermissions`，由驱动映射到 Codex
  approval/sandbox 策略。
- 增加 Rust 协议测试、前端 Provider 路由测试和桌面/Web 回归验证。

Out of scope:

- 不修改 `/api/claude/*`、`useClaudeRun` 或 Claude transcript 导入逻辑。
- 不做 Codex 历史批量导入、线程 fork/archive/delete、Review 模式或用量/限额页面。
- 不做图片、附件、技能、插件和 MCP 管理 UI；首版主聊天只发送文本。
- 不实现 Codex 登录 UI，也不读取或持久化 API key、OAuth token、Cookie 或 CLI 缓存内容。
- 不从 Windows Store 应用目录复制或绕过权限启动受保护的 `codex.exe`；没有可执行的
  独立 CLI 时应明确显示不可用。

## Impact

- Backend：新增 Codex App Server JSON-RPC 驱动，扩展 `agent_run.rs` Provider 分发、
  `agent_runtime.rs` 能力声明与 `backend.rs` CLI 探测/线程校验。
- Frontend：泛化 `useAgentRun`、Provider runtime 路由、状态文案和停止操作。
- Persistence：继续使用现有 `threads.provider/session_id/permission_mode` 与 CodeM 历史，
  不新增凭据字段或 Codex transcript 路径。
- Compatibility：Claude 专用 API/hook 不改；Grok 仍走 ACP 且事件契约不变。
- Security：只记录公开事件摘要；不保存原始 JSON-RPC、隐藏推理、密钥或 secret 回答。

## Acceptance Criteria

- [ ] Registry 仅在实验开关开启且发现可启动 Codex CLI 时将 Codex 标记为可选。
- [ ] 新 Codex 聊天能收到文本增量并以唯一 `done` 或 `error` 终态结束。
- [ ] 已确认的 Codex thread id 能持久化，刷新后下一轮使用 `thread/resume` 续聊。
- [ ] 停止操作发送 `turn/interrupt`，并能稳定结束本地 run。
- [ ] command/file change 等 item 映射为工具 timeline；审批和用户提问可通过现有卡片回写。
- [ ] 默认、自动执行、完全访问三档权限映射有单元测试，运行中不能切换。
- [ ] 缺少或不可启动 Codex CLI 时，Provider 显示不可用且不影响 Claude/Grok。
- [ ] Rust、TypeScript、前端相关测试和生产构建通过；开发服务按修改端重启。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm.cmd run typecheck`
- `node --test dist-tests/lib/agent-provider-registry.test.js dist-tests/lib/multi-provider-chat-routing.test.js dist-tests/lib/agent-run-events.test.js`
- `npm.cmd run build`
- 使用 mock app-server 覆盖 initialize/start/resume/delta/tool/approval/input/interrupt/terminal。
- 若本机存在可启动的独立 Codex CLI，执行一次真实 App Server probe 和文本 smoke。

## Implementation Record
- 2026-07-12T13:29:30.537Z 前端将 openai-codex 路由到 generic Agent runtime；Provider 设置增加显式 Codex probe，Composer 名称/图标/纯文本限制/权限锁定跟随当前 Provider，Codex thread id 与三档权限写入现有线程元数据。

- 2026-07-12T13:29:30.084Z 完成 OpenAI Codex app-server stdio JSONL 驱动：支持 initialize/initialized、account/read、thread start/resume、turn start/interrupt、文本/工具/审批/用户提问/终态映射；增加输出脱敏、大小限制、探测超时和子进程关闭。通用 Agent Run 保持 Grok ACP 行为，Claude 专用 API/hook 未改。
- 2026-07-12T12:54:57.995Z 设计确认：Codex 使用官方 app-server stdio JSONL；首版每个 CodeM run 启动一个进程，成功 thread/start 或 thread/resume 后才持久化 thread id；通用控制命令从 ACP 命名中解耦；default/auto/bypassPermissions 分别映射 untrusted+workspaceWrite、on-request+workspaceWrite、never+dangerFullAccess。当前机器仅有不可由普通进程启动的 Windows Store codex.exe，真实协议以 mock 覆盖并保留 CODEX_CLI_PATH。

- 2026-07-12T12:48:01.633Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T13:35:37.791Z `POST http://127.0.0.1:3002/api/agents/codex/probe`: pass: installed=false initialized=false on protected Windows Store-only installation; Claude and Grok remain available
- 2026-07-12T13:35:37.339Z `browser smoke at http://127.0.0.1:5173`: pass: Codex visible in Provider menu, disabled when CLI unavailable; settings probe shows recovery guidance; no page console errors

- 2026-07-12T13:29:33.221Z `node --import tsx --test src/lib/*.test.ts`: task-related pass; 3 pre-existing unrelated assertions remain: macOS private API feature, desktop managed-backend cleanup, basic settings Git review grouping
- 2026-07-12T13:29:32.780Z `npm.cmd run build`: pass; existing Vite dynamic/static import warnings only

- 2026-07-12T13:29:32.340Z `node --import tsx --test focused Codex/Provider/Agent/Claude regression suite`: pass: 73/73
- 2026-07-12T13:29:31.899Z `npm.cmd run typecheck`: pass

- 2026-07-12T13:29:31.442Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass
- 2026-07-12T13:29:30.993Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass: 37 library tests + 9 desktop tests; 1 authenticated Grok smoke ignored

## Completion Summary
- 2026-07-12T13:35:38.241Z 已接入 OpenAI Codex app-server：完成 CLI 探测、线程创建/恢复、文本与工具流、审批/提问、取消、三档权限、线程元数据和 Provider UI；Claude 专用链路保持不变。Rust 全测、前端聚焦回归、类型检查、生产构建和浏览器 smoke 通过；当前机器无可启动的独立 Codex CLI，因此真实账号 smoke 由协议 mock 覆盖。

## Follow-ups

- Codex 历史导入、模型/effort 列表、附件、Review、MCP 与账号管理另行拆分。
