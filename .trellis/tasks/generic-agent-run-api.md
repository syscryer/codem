# Task: 通用 Agent 运行 API 与 ACP 事件映射

## Background

CodeM 已有 Provider Registry、通用前端 `AgentRunEvent` 类型和 Rust ACP POC，但生产运行仍只支持 `/api/claude/*`。当前 ACP POC 只聚合最终文本，遇到权限请求会直接取消，无法验证工具、人工交互和流式终态是否能进入统一运行协议。

本阶段先建立一条与 Claude Code 完全隔离的实验链路，验证 Grok Build/ACP 到 CodeM 通用事件协议的映射。实验结论成熟后再讨论 Provider 选择 UI、会话持久化和生产迁移。

## Objective

在不改动现有 Claude Code 生产链路的前提下，建立独立通用运行接口并把 ACP 文本、工具、权限、用户输入、完成、失败和取消映射为 AgentRunEvent

## Scope

In scope:

- 新增独立 `/api/agents/run` 实验 API，以及事件重连、权限决定、用户输入和取消控制端点。
- 首个运行实现只支持 `grok-build`，通过本机 `grok agent stdio` 使用 ACP；支持新建会话和传入 `sessionId` 恢复会话。
- 将 ACP 文本、工具调用/更新、权限请求、结构化 elicitation、完成、失败和取消映射为稳定的 `AgentRunEvent` NDJSON。
- ACP 权限响应严格使用官方 v1 `selected + optionId` / `cancelled` 结构；结构化提问按当前 unstable `elicitation/create` form 协议处理。
- 实验运行默认关闭，只有显式设置 `CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN=1` 才可启动 planned Provider。
- 只在内存中保留短期运行事件和控制通道，支持断流重连；完成后定时清理。
- 对工具输入/输出做字段脱敏和大小限制；思考正文、raw ACP 事件、stderr、认证响应不进入通用事件。
- 使用内存 fake ACP transport 覆盖事件顺序和交互写回，并执行显式 ignored Grok smoke。

Out of scope:

- 不修改 `/api/claude/*`、`useClaudeRun`、Composer、现有 CC runtime 或 SQLite schema/历史记录。
- 不把 Grok Build 改为 active/selectable，不新增 Provider 选择 UI，也不让普通聊天入口发送 Grok prompt。
- 不持久化 Grok session、prompt、事件、权限决定或用户答案。
- 不开放客户端指定 CLI 路径、启动参数、认证方式、代理、token 或环境变量。
- 不实现图片/附件/MCP、ACP filesystem/terminal client 能力、URL elicitation 或其他 Provider driver。
- 不承诺 unstable elicitation 协议已经成为生产兼容面。

## Impact

- `src-tauri/src/acp.rs`：增加流式、安全摘要和人工交互控制循环；保留现有 probe 与 `prompt_text` 接口。
- `src-tauri/src/agent_run.rs`：独立实验运行状态、路由、事件映射和生命周期管理。
- `src-tauri/src/agent_runtime.rs`、`src/types.ts`：补齐通用事件/审批选项契约，保持 Claude 类型兼容。
- `src-tauri/src/backend.rs`、`src-tauri/src/lib.rs`：只挂载独立路由，不改 Claude handler/state。
- 持久化影响：无；刷新后只允许在短期内通过内存事件重连，不写 SQLite。

## Acceptance Criteria

- [x] 未设置实验环境变量时，`POST /api/agents/run` 明确拒绝 planned Provider 运行；Provider Registry 仍只有 Claude Code 为 active/selectable。
- [x] 开启实验开关后可用 `grok-build` 新建或恢复 ACP session，并以 NDJSON 返回 `status/session/delta/tool-*/approval-request/request-user-input/done/error` 的适用子集。
- [x] ACP `agent_message_chunk` 增量下发；`agent_thought_chunk` 正文不会下发、记录或拼入最终结果。
- [x] `tool_call` / `tool_call_update` 使用稳定 block index 和 toolCallId，完成/失败映射为 `tool-result + tool-stop`，工具内容有大小上限且敏感字段被脱敏。
- [x] 权限事件保留官方 optionId；批准/拒绝会选取对应 option 并写回 ACP，取消时所有待处理权限请求返回 `cancelled`。
- [x] form elicitation 映射为 `request-user-input`，保留 option value 和 primitive input type，答案通过控制端点写回 `accept + content`；取消写回 `cancel`。
- [x] 每次运行最多产生一个 terminal event；成功、协议 stop reason、取消和运行错误都能结束 NDJSON，不悬挂连接。
- [x] 已完成运行可短期重放事件，过期后自动清理；全链路不写 SQLite。
- [x] fake transport 覆盖文本、工具、权限、提问、恢复/取消、终态唯一和脱敏；Rust、typecheck、Agent 相关前端测试和 production build 通过。全量前端源码断言保留 3 个与本任务无关且对应文件未改的既有失败，已在 Verification Results 明确记录。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `$env:CARGO_TARGET_DIR='D:\\Projects\\codem\\.tmp\\cargo-agent-run'; cargo test --manifest-path src-tauri/Cargo.toml`
- `$env:CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN='1'; $env:GROK_CLI_PATH='<local-grok-path>'; $env:HTTP_PROXY='http://127.0.0.1:7890'; $env:HTTPS_PROXY='http://127.0.0.1:7890'; cargo test --manifest-path src-tauri/Cargo.toml grok_acp_real_smoke -- --ignored --nocapture`
- `npm.cmd run typecheck`
- `node --test --import tsx src/lib/*.test.ts`
- `npm.cmd run build`

## Implementation Record

- 2026-07-12 ACP form elicitation 额外保留 option 的展示 label/实际 value 与 text/number/integer/boolean inputType，写回前按 schema 校验并转换 primitive 类型，避免未来 UI 把显示标题误当协议值。
- 2026-07-12 fake transport 已覆盖思考正文隔离、工具敏感字段脱敏、权限 selected+optionId、elicitation accept+content、预先取消时 pending permission 的 cancelled 响应，以及唯一 terminal event。
- 2026-07-12T10:08:36.400Z 已实现 ACP 流式事件与控制通道、独立 agent_run.rs 实验路由和短期内存事件重连；默认通过 CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN 关闭 planned Provider。文本、工具、权限、elicitation、恢复、取消和唯一终态均已接线，现有 /api/claude 路径与 state 未改。
- 2026-07-12T09:51:53.300Z 已按 ACP 官方 v1/unstable schema 补全任务边界：独立实验 API 默认关闭，仅支持 grok-build；不改 Claude/Composer/SQLite；权限使用 selected+optionId，结构化提问使用 elicitation/create，并明确脱敏、唯一终态和验证口径。

- 2026-07-12T09:42:00.724Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T10:19:10.671Z `git diff --check`: 通过；仅显示 Git 的 LF/CRLF 提示，无 whitespace error。
- 2026-07-12T10:19:10.294Z `cargo clippy --lib --tests -- -D warnings`: 本阶段 acp.rs、agent_run.rs、agent_runtime.rs 无 clippy finding；全命令仍被 backend.rs 20 个历史告警和 1 个历史测试告警阻断。

- 2026-07-12T10:19:09.907Z `npm.cmd run build`: 通过：TypeScript 与 Vite production build 完成，仅有既有 chunk size/dynamic import 警告。
- 2026-07-12T10:19:09.526Z `node --test --import tsx src/lib/*.test.ts`: 381 passed / 3 failed；失败均为未改文件对应的既有源码断言：macOS private-api feature、旧 managed backend 退出清理、Git 审查设置分组，不属于本任务且当前文件内容与 HEAD 一致。

- 2026-07-12T10:19:09.146Z `node --test --import tsx src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts`: 通过：11 passed。
- 2026-07-12T10:19:08.746Z `npm.cmd run typecheck`: 通过。

- 2026-07-12T10:19:08.360Z `隔离后端 /api/agents/run 端到端检查`: 通过：启用实验开关时 POST 返回 200 NDJSON，事件重放得到 API_PONG 与唯一 done(stopReason=end_turn)；关闭开关时返回 403。
- 2026-07-12T10:19:07.975Z `cargo test grok_acp_real_smoke_covers_prompt_load_and_cancel -- --ignored --nocapture（7890 代理）`: 通过：Grok 0.2.93 缓存认证、PONG prompt、session/load 和取消均成功，1 passed。

- 2026-07-12T10:19:07.593Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 22 passed / 1 ignored，桌面 main 9 passed，共 31 passed；无失败。
- 2026-07-12T10:19:07.204Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过，无格式差异。

## Completion Summary
- 2026-07-12T10:20:05.305Z 完成独立通用 Agent 实验运行链路：新增默认关闭的 /api/agents/run 及事件重连、审批、提问和取消端点；Grok ACP 文本/工具/权限/elicitation/完成/错误/取消映射为 AgentRunEvent，支持新建与恢复 session、短期内存重放、唯一终态和敏感字段脱敏。真实 Grok 0.2.93 在 7890 代理下通过认证、prompt、恢复、取消及端到端 API 验证；Claude 生产路径、Composer 和 SQLite 未改。

## Follow-ups

- Provider 选择 UI 与 Composer 接线必须在实验 API 稳定、会话所有权和持久化策略确认后另开任务。
- ACP unstable elicitation 协议升级时，需要按官方 schema 重新核对 capability 和响应结构。
- Codex、自研 Agent 和其他 CLI driver 不在本任务内，后续复用同一 AgentRunEvent/控制契约实现。
- 全量前端源码断言中的 3 个既有失败应在独立维护任务中修正测试或恢复对应行为，不在本 Agent API 任务中顺带处理。
