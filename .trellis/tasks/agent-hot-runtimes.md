# Task: Grok 与 Codex 热会话运行时

## Background

Claude Code 已按 CodeM thread 维护常驻 stdin runtime，连续轮次只在首轮启动 CLI，后续直接复用同一子进程。
Grok ACP 与 OpenAI Codex app-server 虽然会把 provider session/thread id 持久化到 CodeM thread，
但当前每一轮仍重新 spawn、initialize、authenticate、load/resume，结束后立即 shutdown。
这会重复支付 CLI 冷启动和协议初始化成本，也让取消后的下一轮无法复用仍然健康的 provider 进程。

本任务把通用 Agent 从“每轮一次性进程”升级为“每个 CodeM thread 一个常驻 Provider actor”。
actor 独占可变 stdio client 和 provider session，HTTP run record 继续负责事件重连、控制请求和短期事件保留。

## Objective

让 Grok ACP 与 Codex app-server 按 CodeM thread 复用常驻子进程和 provider 会话，并完整处理取消、配置变化、删除和崩溃生命周期

## Scope

In scope:

- `/api/agents/run` 接收 `threadId`，CodeM 前端每次运行都发送当前 thread id。
- 新增可 clone 的 `AgentRunService`，统一持有 run records 和按 thread 索引的常驻 runtime。
- Grok ACP actor 仅在首轮执行 spawn、initialize、authenticate、session/new 或 session/load；后续轮次复用同一 client 和 session。
- Codex app-server actor 仅在首轮执行 spawn、initialize、thread/start 或 thread/resume；后续轮次复用同一 client 和 thread。
- 同一 thread 同时只允许一个 active run；不同 thread 使用独立 actor，可并行运行。
- 当前 turn 取消后保留健康进程；关闭 thread/project、显式关闭 runtime 或子进程异常退出时清理 actor。
- provider、命令路径、工作目录、权限模式、模型、reasoning effort 或 provider session 不兼容时关闭旧 runtime 并重建。
- 增加 runtime 状态和显式关闭 API，便于桌面生命周期、测试和后续诊断。
- run record 保存 thread id，删除 thread/project 时同步清理通用 Agent runtime 与短期事件记录。
- 缺少 `threadId` 的旧 API 请求继续使用一次性冷运行，作为明确的兼容模式；CodeM 主链路不使用该模式。

Out of scope:

- 不把多个 CodeM thread 复用到一个全局 Grok/Codex 子进程。
- 不给热 runtime 增加闲置 TTL；生命周期与 Claude Code 保持一致。
- 不修改 Claude Code 专用 runtime、事件协议、历史导入或审批语义。
- 不新增 provider 凭据、token、原始 JSON-RPC/ACP 日志或隐藏推理持久化。
- 不在本任务中接入新的 Provider。

## Impact

- Frontend：`src/hooks/useAgentRun.ts` 补发 `threadId`，相关路由契约测试同步更新。
- Backend：`src-tauri/src/agent_run.rs` 抽出共享 service、runtime actor、状态和关闭接口；
  `src-tauri/src/backend.rs` 共享 service，并在 thread/project 删除时调用通用 Agent 清理。
- Protocol：现有 NDJSON `AgentRunEvent`、控制端点和 session event 保持不变；只扩展 run 请求和 runtime 管理接口。
- Persistence：继续复用 `threads.provider/session_id/permission_mode/model/reasoning_effort`，不新增数据库字段。
- Security/privacy：runtime 仅在内存保存配置摘要、进程句柄和 provider session id，不保存凭据或完整输入内容。

## Acceptance Criteria

- [x] 同一 Grok thread 连续两轮只 spawn/initialize/authenticate 一次，第二轮复用同一 ACP session。
- [x] 同一 Codex thread 连续两轮只 spawn/initialize 一次，第二轮复用同一 app-server thread。
- [x] 同一 thread 并发启动第二个 run 返回 409，不覆盖当前运行；不同 thread 可以独立运行。
- [x] 取消当前 turn 后 runtime 仍为 ready，下一轮继续复用；显式关闭后下一轮重新冷启动。
- [x] 工作目录、权限、模型、effort、provider、命令路径或 session 不兼容时旧 runtime 被关闭且只重建一次。
- [x] 删除 thread/project 会关闭对应 Grok/Codex actor，并清理该 thread 的 run records。
- [x] 子进程或协议连接异常时 runtime 从索引移除，当前 run 发送唯一 error，下一轮可冷恢复。
- [x] runtime 状态接口能区分 absent、starting、ready、running、closed/failed，并且不泄露 prompt、凭据或原始协议消息。
- [x] 旧的不带 `threadId` 请求仍能以一次性模式运行；CodeM 前端请求始终携带 `threadId`。
- [x] 多模态 `contentBlocks`、队列、审批、提问、取消和事件重连语义保持不变。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- Rust fake transport 定向测试：复用、取消保活、并发冲突、配置重建、显式关闭、删除清理和崩溃恢复。
- `node --test --import tsx src/lib/multi-provider-chat-routing.test.ts src/lib/queued-prompts.test.ts src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `git diff --check`
- 获得编译许可后执行 Rust 定向测试、真实 Grok/Codex 两轮延迟与 spawn 次数验证，并按修改端重启桌面开发模式。

## Implementation Record
- 2026-07-13T12:34:45.111Z 按项目规则未执行会触发编译的 cargo check/test，也未重启桌面后端。待用户明确允许编译后，需要执行 Rust 定向/全量测试，并用真实 Grok 与 Codex 连续两轮验证 spawn/initialize 仅一次、取消后复用、配置变化重建和 runtime 状态接口。

- 2026-07-13T12:32:09.901Z 已实现共享 AgentRunService 与 per-thread Provider actor：Grok/Codex 首轮初始化后常驻，后续 run 复用同一 client/session；同 thread 并发返回 409，取消只取消当前 turn，配置或 session 不兼容时重建。新增 runtime 状态/关闭接口，thread/project 删除同步 forget runtime 与 run records；前端 run 请求补发 threadId，Grok cancel capability 更正为 soft。
- 2026-07-13T12:13:22.803Z 已确认 per-thread Provider actor 方案和 API 边界：CodeM 主链路新增 threadId；旧请求无 threadId 时保留一次性兼容。runtime 兼容键覆盖 provider、命令、cwd、权限、模型、effort、session；取消保活，删除/显式关闭/崩溃清理，不设置 TTL。

- 2026-07-13T12:11:52.633Z Task created by Trellis automation.

## Verification Results

- 2026-07-13T14:04:09.839Z `git diff --check`: 通过：无 whitespace error，仅有 Windows LF/CRLF 提示。
- 2026-07-13T14:04:08.521Z `桌面开发模式重启与 runtime API 探针`: 通过：npm run desktop:dev 编译成功；5173/3001 监听，/api/runtime/identity 返回 codem+rust，runtime absent/ready/closed 状态与关闭接口正常。

- 2026-07-13T14:04:07.669Z `Grok 真实取消后热会话复用`: 通过：DELETE run 返回 cancelled=true，终态 stopReason=cancelled；runtime 保持 ready，下一轮复用同一 session 并返回 GROK_AFTER_REAL_CANCEL。
- 2026-07-13T14:04:06.857Z `Codex 0.144.1 真实连续两轮热会话 已复用 OpenAI Codex 热会话，两轮 thread/sessionId 相同，runtime 两轮后均为 ready，结果 CODEX_HOT_1/2。`: 通过：第二轮事件为

- 2026-07-13T14:04:06.026Z `Grok 0.2.99 真实连续两轮热会话 已复用 Grok Build 热会话，两轮 sessionId 相同，runtime 两轮后均为 ready，结果 GROK_HOT_1/2。`: 通过：第二轮事件为
- 2026-07-13T14:04:05.178Z `npm run typecheck`: 通过：TypeScript project references 无错误。

- 2026-07-13T14:04:04.395Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 53 passed / 1 ignored，desktop main 9 passed，bin/doc tests 无失败；热 runtime 复用、并发冲突、取消保活、关闭和 thread 清理单测通过。
- 2026-07-13T12:34:44.434Z `git diff --check`: 通过：无 whitespace error；仅有 Windows LF/CRLF 提示。

- 2026-07-13T12:34:43.362Z `node --test --import tsx src/lib/multi-provider-chat-routing.test.ts src/lib/agent-provider-registry.test.ts src/lib/queued-prompts.test.ts src/lib/agent-run-events.test.ts`: 通过：43/43，覆盖 threadId 请求契约、Provider capability、队列和 Agent 事件回归。
- 2026-07-13T12:34:42.031Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust 源码格式无差异，未触发编译。

## Completion Summary
- 2026-07-13T14:04:10.715Z 完成 Grok ACP 与 Codex app-server 每 thread 常驻热会话：连续轮次复用同一进程和 provider session，取消后保活，配置变化重建，同 thread 并发保护，状态/显式关闭接口及 thread/project 删除清理均已接通。Rust 全测、TypeScript、前端回归、真实 Grok/Codex 双轮与真实取消后复用验证通过；桌面开发模式已重启。

## Follow-ups

- 后续可基于真实使用数据单独评估闲置 TTL 或全局进程池；当前不提前引入。
