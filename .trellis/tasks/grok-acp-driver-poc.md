# Task: Grok ACP Driver POC

## Background

多 Agent Runtime 基础阶段已经建立 Provider Registry 和通用事件命名，但 Grok Build 仍是 planned Provider，尚未进入实际发送链路。本机安装了 Grok Build `0.2.93`，真实命令确认其通过 `grok agent stdio` 暴露 ACP JSON-RPC，并使用 NDJSON framing。

用户要求后续支持 Grok、Codex 和自研 Agent，同时尽可能不影响当前 Claude Code。本 POC 因此只新增隔离的 ACP Driver 与 Grok 诊断探针，不修改 Claude runtime、前端发送 hook、线程持久化或 Provider 选择。

## Objective

实现与 Provider 无关的 Rust ACP stdio Driver，并在不改动 Claude Code 生产链路的前提下验证 Grok Build 初始化、认证能力、文本流、取消和会话恢复协议

## Scope

In scope:

- 实现通用 Rust ACP NDJSON transport，支持 JSON-RPC request、notification、response 和 agent-to-client request。
- 支持 ACP `initialize`、`authenticate`、`session/new`、`session/load`、`session/prompt` 和 `session/cancel`。
- prompt 过程收集公开的 agent message chunk、update 类型和 stop reason，不记录或返回思考文本。
- POC 阶段对 `session/request_permission` 安全返回 cancelled，其他未知 client request 返回 method-not-found。
- 新增只读/诊断性质的 Grok ACP probe API，返回脱敏后的版本、capability、认证状态、模型摘要和错误。
- 使用内存 fake ACP transport 覆盖握手、流式文本和取消状态机。
- 使用本机 Grok Build 做真实 initialize、authenticate、new/load、prompt 和 cancel 验证。

Out of scope:

- 不把 Grok 改为 active/selectable Provider，不增加前端 Provider 选择。
- 不把 Grok prompt 接入现有聊天 UI、队列、guide、审批卡片或历史持久化。
- 不修改 `/api/claude/*`、`ClaudeRuntimeRecord`、`useClaudeRun`、Claude CLI 参数或 Claude transcript 导入。
- 不实现 ACP 文件系统、terminal、MCP、tool call UI、图片输入和 permission UI 写回。
- 不保存 token、认证结果详情、邮箱、team 信息、代理地址或 Grok raw event。
- 不自动执行 `grok login`，不修改系统代理或 Grok 配置。

## Impact

- backend：新增独立 `acp` 模块和 `/api/agents/grok/probe` POST 路由；现有 Agent Registry 和 Claude runtime 只做增量引用。
- frontend：无 UI 和运行状态变更。
- persistence：无 SQLite schema、thread metadata 或历史变更。
- security/privacy：probe 丢弃 authenticate 原始结果；只返回布尔认证状态和公开 capability/model 摘要。
- compatibility：当前 3001 Claude 服务不为本任务主动重启；验证使用隔离 backend target/端口。

## Acceptance Criteria

- [x] ACP transport 使用一行一个 JSON-RPC message，不使用终端文本抓取或 Content-Length framing。
- [x] initialize 可以解析 loadSession、prompt/MCP capability、auth method、agent version 和模型摘要。
- [x] authenticate 原始结果不会进入 API 响应、日志、task record 或持久化。
- [x] session/new 和 session/load 使用独立外部 session ID，只有成功响应才交给调用方。
- [x] session/prompt 只收集公开 agent message，返回明确 stop reason；思考事件只计数不保存正文。
- [x] session/cancel 可以在 prompt 运行中发送，并能处理 `stopReason=cancelled`。
- [x] planned Grok Provider 仍不可选择，现有 Claude Code 路由、状态机和持久化不变。
- [x] fake ACP tests、完整 Rust tests、Claude frontend regression、typecheck、fmt 和 diff check 通过。
- [x] 真实 Grok `0.2.93` 在子进程局部 7890 代理下完成 initialize/auth/new/load/prompt/cancel POC。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml acp`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npx tsx --test src/lib/agent-provider-registry.test.ts src/lib/conversation.test.ts src/lib/queued-prompts.test.ts src/lib/claude-run-attachments.test.ts src/hooks/useClaudeRun.send-latency.test.ts`
- `npm run typecheck`
- 隔离 backend 调用 `POST /api/agents/grok/probe` 以及现有 Claude health/models API。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-12T08:47:03.803Z 附加质量检查：cargo clippy --all-targets -- -D warnings 未作为本任务门禁通过，原因是现有 backend.rs 有 20 个历史 lint（while-let、needless-borrow、too-many-arguments 等）；新增 acp.rs 未报告 clippy 问题。为保护 CC，本任务不混入这些无关重构。

- 2026-07-12T08:44:56.446Z 完成 Rust ACP Driver 与 Grok probe：通用 AcpConnection 支持 initialize/authenticate/session new/load/prompt/cancel，公开文本限长收集，思考只计数，POC permission 默认 cancelled，stdio 子进程可回收；新增 POST /api/agents/grok/probe，仅返回脱敏 capability/auth boolean/model 摘要。fake ACP 4 项与显式真实 Grok smoke 均通过，真实 smoke 覆盖 PONG、跨进程 load 和 stopReason=cancelled，结束后无 grok 进程残留。
- 2026-07-12T08:39:28.675Z 真实 Grok Build 0.2.93 已校准：ACP 使用 NDJSON；initialize 返回 loadSession=true、image=false、embeddedContext=true、MCP http/sse、cached_token/grok.com auth methods；7890 子进程代理下 cached_token 认证成功；session/new、session/load、agent_message_chunk、end_turn 和新 session 的 session/cancel -> stopReason=cancelled 均验证成功。session/load replay 会伴随 Post-replay flush session not found warning，但历史消息仍正常 replay。

- 2026-07-12T08:22:40.984Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T08:46:56.266Z `真实 Grok smoke：显式 GROK_CLI_PATH + 127.0.0.1:7890 子进程代理 + ignored test`: 通过：Rust ACP Driver 完成 initialize/auth/new/PONG、跨进程 load 和 cancel，stopReason=end_turn/cancelled，结束后无 Grok 子进程残留。
- 2026-07-12T08:46:46.781Z `npm.cmd run typecheck; cargo fmt --manifest-path src-tauri/Cargo.toml --check; git diff --check`: 通过：TypeScript 无错误、Rust 格式无差异、diff 无空白错误；仅保留仓库现有 Windows LF/CRLF 提示。

- 2026-07-12T08:46:46.374Z `npx.cmd tsx --test src/lib/agent-provider-registry.test.ts src/lib/conversation.test.ts src/lib/queued-prompts.test.ts src/lib/claude-run-attachments.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: 通过：38/38，现有 Claude 事件、停止、队列、附件、恢复关键回归无失败。
- 2026-07-12T08:46:45.983Z `隔离 backend 39211：POST /api/agents/grok/probe；GET /api/agents/providers、/api/health、/api/claude/models`: 通过：probe initialized/authenticated=true，版本 0.2.93，loadSession=true，模型 grok-4.5/Composer 2.5；响应无邮箱、team、token value、subscription 字段；Grok 仍 planned/selectable=false，Claude health/models 正常。

- 2026-07-12T08:46:45.176Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 16/16，桌面 main 9/9，0 失败；真实 Grok smoke 默认忽略，普通测试不会依赖外部 CLI 或调用模型。

## Completion Summary
- 2026-07-12T08:47:55.401Z 完成 Grok ACP Driver POC：新增通用 Rust NDJSON/JSON-RPC stdio transport，支持 initialize、cached-token authenticate、session new/load/prompt/cancel，公开文本限长、思考正文不保留、POC 权限默认取消和子进程回收；新增脱敏 POST /api/agents/grok/probe。Grok 0.2.93 在 7890 子进程代理下通过真实 Rust smoke（PONG、跨进程恢复、取消），但仍保持 planned/selectable=false；Claude 路由、runtime、hook、数据库和当前 3001 服务未修改或重启。

## Follow-ups

- 设计 ACP tool call、permission request 和用户输入到 CodeM timeline 的正式映射，再开放 Grok Provider 选择。
- 将代理配置纳入 Provider installation/auth profile 设计，不在 POC endpoint 中接受或保存任意代理地址。
- 调查 Grok `session/load` 成功后仍输出 `Post-replay flush ... session not found` warning 的版本行为；当前历史消息仍可正常 replay。
- 在正式接入任务中覆盖图片 capability、MCP、模型/effort 切换、usage/context 和 session 列表导入。
- 单独清理 Rust backend 现有 clippy baseline；本 POC 不混入与 ACP 无关的旧代码重构。
