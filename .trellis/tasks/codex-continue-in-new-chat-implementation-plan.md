# Codex 在新聊天中继续 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 Codex 原生 `thread/fork` 将当前完整已保存会话创建为独立新聊天，并保证双 ID、历史来源、运行互斥和失败恢复正确。

**Architecture:** 前端只提交源 CodeM thread ID 和操作 ID；后端从 SQLite 读取受信任配置，预写最小 Fork 操作记录，再通过源 thread 的 Codex runtime actor 串行调用 App Server。Provider 历史先归一化为 CodeM `ConversationTurn` 再持久化，不复制源聊天本地消息；Provider 成功后的任何本地失败都由操作记录和只读 `thread/read` / `thread/list` 恢复。

**Tech Stack:** React 19、TypeScript 5.9、Rust、Axum、Tokio、rusqlite、Codex App Server JSON-RPC、Node test runner、Tauri 桌面验收。

---

## Source Of Truth

- 已确认规格：`.trellis/tasks/codex-continue-in-new-chat.md`
- 能力路线：`.trellis/tasks/codex-capability-parity-roadmap.md`
- 官方协议：[Codex App Server](https://developers.openai.com/codex/app-server/) 的 `thread/fork` 只传 `threadId`，省略 `lastTurnId` 和 `ephemeral`；返回新 thread，并发送 `thread/started`。
- 恢复查询不依赖实验能力：`thread/list.parentThreadId` 需要 `experimentalApi`，本计划改用稳定的分页/排序字段，并在客户端按 `forkedFromId` 和时间窗口筛选。
- 当前实现基线：`db959fd` 已完成原生 Compact；本计划不得恢复 `/compact` 文本回退或改变 Claude Code 行为。

## File Map

| 文件 | 职责 |
| --- | --- |
| `src-tauri/src/codex_app_server.rs` | Fork capability、`thread/fork`、`thread/read`、未知结果候选查询和安全的 stored-turn 归一化 |
| `src-tauri/src/agent_run.rs` | Fork runtime command、源 actor 串行、能力缓存、结果分类和只读恢复命令 |
| `src-tauri/src/backend.rs` | 路由、受信任源 thread 校验、操作记录、SQLite 事务、历史写入与恢复编排 |
| `src/types.ts` | Fork capability、availability、API response 和工作区状态类型 |
| `src/lib/codex-thread-fork.ts` | 纯前端可用性判断、capability key、Fork response 到 `ThreadDetail` 的归一化 |
| `src/lib/codex-thread-fork.test.ts` | 前端领域逻辑、继承/隔离和长历史引用稳定性测试 |
| `src/hooks/useWorkspaceState.ts` | capability 预取、Fork 请求、幂等 operation ID、工作区原子接入和激活 |
| `src/components/ChatHeader.tsx` | 当前聊天顶部“在新聊天中继续”入口 |
| `src/components/SidebarProjects.tsx` | 侧边栏聊天右键入口及打开菜单时的 capability 预取 |
| `src/App.tsx` | 组合 runtime busy、pending request、capability 和 Fork action，并传给两个菜单 |
| `src/lib/codex-thread-fork-ui.test.ts` | 两个入口、禁用原因、App 接线和无其他 Provider 回退的 UI 契约测试 |

不新增 CSS：复用已有 `.workspace-menu-item` 及其 `:disabled` 样式；图标使用 `lucide-react` 的 `MessageSquarePlus`。

## Execution Setup

进入 Task 1 前先为实现阶段创建新的 Trellis session；计划阶段 session 已完成，不得复用：

```powershell
npm run trellis -- start codex-continue-in-new-chat --title "实现 Codex 在新聊天中继续" --objective "按 Task 1-7 落地原生完整会话 Fork、幂等恢复和双入口。"
npm run trellis -- status
```

Expected: status 指向 `.trellis/tasks/codex-continue-in-new-chat.md`，并生成新的 `*-codex-continue-in-new-chat.md` implementation session record。Task 1-7 的关键决定、测试红绿证据和提交摘要全部写入该新 record。

### Task 1: Codex App Server Fork 协议与历史快照

**Files:**
- Modify: `src-tauri/src/codex_app_server.rs`

- [ ] **Step 1: 写 capability、请求参数和快照归一化失败测试**

在现有 `#[cfg(test)] mod tests` 中用 `mock_connection`、`read_wire`、`write_wire` 增加以下测试矩阵；测试体必须写出完整 arrange/act/assert，不保留空函数：

| 测试名 | 输入与协议响应 | 必须断言 |
| --- | --- | --- |
| `fork_probe_classifies_supported_and_method_not_found` | `{}` probe 分别返回 `-32602`、同时含 `missing field`/`threadId` 的 `-32600`、`-32601` 和普通执行错误 | 前两者为 supported，`-32601` 为 unsupported，普通错误原样返回且不缓存 |
| `fork_thread_omits_last_turn_and_ephemeral_then_reads_full_history` | source `thread/read` 为 idle，Fork 返回 `fork-thread`，随后 history fixture 含 userMessage、agentMessage、commandExecution、fileChange、contextCompaction | Fork params 严格等于 `{ "threadId": "source-thread" }`；后续 read 为 `{ "threadId": "fork-thread", "includeTurns": true }`；结果 ID 和 item 顺序稳定 |
| `fork_rejects_active_source_and_invalid_child_id` | source status 为 active；Fork 返回空 ID；Fork 返回 source ID | 三种情况均失败，且 active source 不发送 `thread/fork` |
| `fork_history_failure_preserves_created_provider_id` | Fork 成功后 `thread/read` 失败 | 专用错误包含 `fork-thread`，不把结果降级为普通执行失败 |
| `fork_candidate_scan_filters_locally_without_experimental_fields` | 两页 `thread/list` 混入旧 child、其他 parent、零/一/多匹配 | 请求不含 `parentThreadId`/`ancestorThreadId`；仅按 `forkedFromId`、createdAt 窗口和非 ephemeral 结果返回候选 |
| `fork_stored_snapshot_redacts_private_reasoning_and_unknown_raw_items` | history 含 reasoning、未知 item、base64 image、local image 和带敏感字段的 tool | reasoning/未知/base64 不进入结果；local image 只留路径元数据；工具输入继续经过 `sanitize_json_value` |

- [ ] **Step 2: 运行测试并确认失败原因是 Fork API 尚不存在**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server::tests::fork -- --nocapture`

Expected: FAIL，缺少 `CodexConnection::probe_fork_capability`、`fork_thread_snapshot` 和快照类型。

- [ ] **Step 3: 增加最小协议类型和方法**

在 `CodexCompactCapability` 附近增加：

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodexForkCapability { Supported, Unsupported }

#[derive(Clone, Debug, PartialEq)]
pub struct CodexForkOutcome {
    pub provider_thread_id: String,
    pub forked_from_id: Option<String>,
    pub turns: Vec<CodexStoredTurn>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexStoredTurn {
    pub id: String,
    pub status: String,
    pub items: Vec<CodexStoredItem>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CodexStoredItem {
    UserMessage { id: String, content: Vec<CodexUserInput> },
    AgentMessage { id: String, text: String },
    Tool { id: String, name: String, input: Option<Value>, result: String, is_error: bool },
    ContextCompaction { id: String },
}
```

实现以下方法，并在 `CodexStdioClient` 上添加同名委托：

```rust
pub async fn probe_fork_capability(&mut self) -> Result<CodexForkCapability, CodexAppServerError>;
pub async fn read_thread_snapshot(&mut self, thread_id: &str) -> Result<Vec<CodexStoredTurn>, CodexAppServerError>;
pub async fn fork_thread_snapshot(&mut self, source_thread_id: &str) -> Result<CodexForkOutcome, CodexAppServerError>;
pub async fn find_fork_candidates(
    &mut self,
    source_thread_id: &str,
    started_at_seconds: i64,
) -> Result<Vec<String>, CodexAppServerError>;
```

实现约束：

- capability 分类复用 Compact 的严格规则，但错误信息检查仍要求同时包含 `missing field` 和 `threadId`。
- Fork 前先 `thread/read(includeTurns: false)`，若 `status.type == "active"` 则返回明确执行错误，避免外部客户端正在运行时复制中间态。
- Fork 响应先提取、校验新 `thread.id != source_thread_id`；即使随后历史读取失败，也要用一个包含新 Provider ID 的专用错误变体返回，供后端记录已创建事实。
- `thread/started` 通知只忽略/关联，不触发第二次本地创建。
- `read_thread_snapshot` 只接受匹配的 thread ID 和数组 turns；user text/local image 只保留文本或路径元数据，不保留 base64。
- agentMessage 保留可见文本；reasoning/plan 私有内容丢弃；工具复用 `tool_started_event`、`tool_completed_event` 和 `sanitize_json_value`；未知 item 丢弃。
- `find_fork_candidates` 调用稳定的 `thread/list` 字段：`sortKey: created_at`、`sortDirection: desc`、`archived: false`，并显式包含 `appServer` 等公开 `sourceKinds`；不得发送需要 `experimentalApi` 的 `parentThreadId`/`ancestorThreadId`。响应在本地按 `forkedFromId`、操作时间窗口和 `ephemeral=false` 过滤，分页设 100 页安全上限。

- [ ] **Step 4: 运行协议测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server::tests::fork -- --nocapture`

Expected: PASS；至少覆盖 supported、unsupported、请求字段、ID 校验、active source、历史读取失败携带新 ID、零/单/多候选和历史脱敏。

- [ ] **Step 5: 提交协议层**

```powershell
git add -- src-tauri/src/codex_app_server.rs
git commit -m "feat: add native Codex thread fork protocol"
```

### Task 2: Runtime Actor Fork 控制与能力缓存

**Files:**
- Modify: `src-tauri/src/agent_run.rs`
- Test: `src-tauri/src/agent_run.rs` 内联 tests

- [ ] **Step 1: 写 actor 串行、互斥和结果分类失败测试**

新增完整测试，统一使用 `fork_` 前缀以便定向执行：

| 测试名 | 必须断言 |
| --- | --- |
| `fork_hot_runtime_dispatches_over_source_actor` | Ready 且 config/session 匹配时，现有 command channel 收到 `AgentRuntimeCommand::Fork` |
| `fork_cold_or_closed_runtime_starts_one_source_actor` | 无 runtime、Closed、Failed 三种状态只启动一个绑定 source session 的 actor，不创建聊天 run record |
| `fork_rejects_running_compact_turn_and_mismatched_identity` | `current_run_id`、Starting/Running、非 Codex、session/config 不匹配分别返回 conflict/bad request |
| `fork_actor_returns_provider_outcome_without_agent_run_events` | oneshot 收到 outcome；records 中没有普通 run；没有 Done/Error/ContextCompaction 聊天事件 |
| `fork_capability_cache_is_keyed_by_command_channel_and_config_args` | 同 key 只 probe 一次；refresh、command、channel fingerprint、config args 变化重新 probe |
| `fork_actor_shutdown_resolves_acknowledgement` | resume 失败、shutdown 和 command channel 关闭均结束 oneshot，不悬挂 handler |

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::fork -- --nocapture`

Expected: FAIL，缺少 Fork command、service API 和 capability cache。

- [ ] **Step 3: 增加 runtime 控制 DTO 和错误分类**

增加 crate 内 API：

```rust
pub(crate) struct AgentThreadControlConfig {
    pub thread_id: String,
    pub session_id: String,
    pub working_directory: String,
    pub permission_mode: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub channel_id: Option<String>,
}

pub(crate) enum AgentThreadForkError {
    Unsupported(String),
    Conflict(String),
    Rejected(String),
    Uncertain(String),
    ProviderCreated { provider_thread_id: String, message: String },
    Internal(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentForkCapabilityState { Supported, Unsupported, Error }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentForkCapabilitySummary {
    pub state: AgentForkCapabilityState,
    pub message: Option<String>,
}

pub(crate) enum AgentForkReconcileResult {
    None,
    One(CodexForkOutcome),
    Multiple(Vec<String>),
}
```

`AgentRunService` 暴露：

```rust
pub(crate) async fn probe_codex_fork_capability(
    &self,
    config: AgentThreadControlConfig,
    refresh: bool,
) -> Result<AgentForkCapabilitySummary, AgentThreadForkError>;

pub(crate) async fn fork_codex_thread(
    &self,
    config: AgentThreadControlConfig,
    operation_id: String,
) -> Result<CodexForkOutcome, AgentThreadForkError>;

pub(crate) async fn reconcile_codex_thread_fork(
    &self,
    config: AgentThreadControlConfig,
    operation_id: String,
    started_at_seconds: i64,
) -> Result<AgentForkReconcileResult, AgentThreadForkError>;
```

- [ ] **Step 4: 扩展 actor command，但不污染普通聊天事件**

把 command 扩展为：

```rust
struct AgentRuntimeFork {
    operation_id: String,
    started_at_seconds: i64,
    mode: AgentRuntimeForkMode,
    acknowledgement: oneshot::Sender<Result<AgentForkReconcileResult, AgentThreadForkError>>,
}

enum AgentRuntimeForkMode { Create, Reconcile }

enum AgentRuntimeCommand {
    Run(AgentRuntimeRun),
    Compact(AgentRuntimeCompact),
    Fork(AgentRuntimeFork),
}
```

必须同步重构 `run_agent_runtime_actor`：

- Run/Compact 保持既有 event stream 和 terminal event。
- Fork 使用 `current_run_id = "fork:<operationId>"` 作为互斥标识，但不写 `AgentRunRecord`，不产生聊天 turn。
- actor 启动、resume、shutdown 或 session mismatch 时通过 oneshot 返回错误；不能调用 `push_terminal` 假装普通 run 失败。
- Fork 完成后清除 `current_run_id` 并回到 Ready；fatal 子进程错误才把 runtime 标为 Failed。
- capability 按 command、channel fingerprint、codex config args 缓存；method-not-found 在当前 runtime 生命周期内熔断。

- [ ] **Step 5: 运行 runtime 与既有 Compact/Steer 回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests -- --nocapture`

Expected: PASS；Fork 不产生 run event，Compact/Steer actor 行为不变。

- [ ] **Step 6: 提交 runtime 控制层**

```powershell
git add -- src-tauri/src/agent_run.rs
git commit -m "feat: route Codex thread fork through runtime actor"
```

### Task 3: SQLite Fork 操作记录与原子本地落库

**Files:**
- Modify: `src-tauri/src/backend.rs`
- Test: `src-tauri/src/backend.rs` 内联 tests

- [ ] **Step 1: 写迁移、最小记录和事务回滚失败测试**

新增完整测试，统一使用 `fork_operation_` 前缀：

| 测试名 | 必须断言 |
| --- | --- |
| `fork_operation_schema_keeps_only_bounded_recovery_metadata` | 表仅含 operation/source/provider/local/status/time/error 元数据；不存在 prompt、history、raw_rpc、env 字段 |
| `fork_operation_prepare_reuses_one_non_terminal_source_operation` | 同一 source 的第二次 prepare 返回同一 operation；唯一部分索引拒绝第二条非终态记录 |
| `fork_operation_failed_without_provider_can_rearm_explicit_retry` | 明确失败且无 provider ID 时，同 operation ID 的用户重试可回到 `provider_pending`；有 provider ID 时禁止 rearm |
| `fork_operation_restart_moves_inflight_pending_to_result_unknown` | 模拟重启后，遗留 `provider_pending` 先变为 `result_unknown`，后续只能 reconcile，不能 create |
| `fork_operation_finalize_inherits_identity_and_writes_provider_history` | 新双 ID；项目/cwd/provider/model/effort/permission/channel/title 继承；history 只来自 provider snapshot；source messages 不变 |
| `fork_operation_finalize_rolls_back_thread_history_selection_and_status_together` | 注入非法 history 后 child/messages/selection 均不存在；此前已提交的 operation 仍为 `provider_succeeded` |
| `fork_operation_source_pending_request_blocks_prepare` | 已持久化 approval 或 user-input 的 source 返回 conflict，且不插入 operation |

- [ ] **Step 2: 运行数据库测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::fork_operation -- --nocapture`

Expected: FAIL，缺少表、operation helpers 和原子 finalize。

- [ ] **Step 3: 添加最小恢复表和索引**

在 `initialize_workspace_database` 中加入：

```sql
CREATE TABLE IF NOT EXISTS thread_fork_operations (
  operation_id TEXT PRIMARY KEY,
  source_thread_id TEXT NOT NULL,
  source_provider_thread_id TEXT NOT NULL,
  provider_thread_id TEXT UNIQUE,
  local_thread_id TEXT,
  status TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_fork_operations_source_status
ON thread_fork_operations (source_thread_id, status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_fork_operations_one_active_source
ON thread_fork_operations (source_thread_id)
WHERE status IN ('provider_pending', 'provider_succeeded', 'result_unknown', 'history_pending');
```

允许的状态固定为：`provider_pending | provider_succeeded | result_unknown | history_pending | completed | failed`。`last_error` 先使用现有敏感赋值脱敏和长度限制，只保存用户可见摘要。应用初始化时把遗留的 `provider_pending` 原子改为 `result_unknown`；该状态表示上次进程可能已发出 Provider 请求，恢复流程绝不能直接再次 Fork。

- [ ] **Step 4: 实现操作记录和原子 finalize helpers**

增加明确的持久化 DTO 和状态枚举：

```rust
#[derive(Clone, Debug)]
struct ForkSourceThread {
    id: String,
    project_id: String,
    provider: String,
    title: String,
    custom_title: bool,
    provider_thread_id: String,
    working_directory: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    permission_mode: Option<String>,
    agent_channel_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ThreadForkOperationStatus {
    ProviderPending,
    ProviderSucceeded,
    ResultUnknown,
    HistoryPending,
    Completed,
    Failed,
}

#[derive(Clone, Debug)]
struct ThreadForkOperation {
    operation_id: String,
    source_thread_id: String,
    source_provider_thread_id: String,
    provider_thread_id: Option<String>,
    local_thread_id: Option<String>,
    status: ThreadForkOperationStatus,
    started_at_ms: i64,
    last_error: Option<String>,
}
```

随后增加 helpers：

```rust
fn prepare_thread_fork_operation(
    connection: &mut Connection,
    source: &ForkSourceThread,
    requested_operation_id: &str,
    now_ms: i64,
) -> ApiResult<ThreadForkOperation>;

fn mark_fork_provider_succeeded(
    connection: &Connection,
    operation_id: &str,
    provider_thread_id: &str,
) -> ApiResult<()>;

fn finalize_local_thread_fork(
    connection: &mut Connection,
    source: &ForkSourceThread,
    operation: &ThreadForkOperation,
    provider_turns: &[Value],
    history_pending: bool,
) -> ApiResult<(Value, String)>;
```

实现时把 `write_thread_history` 拆为“开启事务的外层”和可接收 `&Connection`/`&Transaction` 的内层写入函数，确保 child row、history、`activeProjectId`、`activeThreadId` 和 operation 状态一次提交。不得调用 `create_thread_row` 后再开启第二个历史事务。

`ForkSourceThread` 从数据库读取 title/custom_title/project/provider/session/cwd/model/effort/permission/channel；Provider 必须是 `openai-codex`，`session_id` 非空，路径必须仍属于同项目，并通过持久化 history 确认没有 pending approval/user-input。新 thread 不复制 `pinned_at`、transcript、messages、tool_calls 或运行状态。

状态转换固定为：新请求 `provider_pending -> provider_succeeded -> completed|history_pending`；明确 Provider 失败 `provider_pending -> failed`；超时/连接断开/进程重启 `provider_pending -> result_unknown`；`result_unknown` 只允许只读 reconcile；`provider_succeeded` 只允许本地 finalize；`history_pending` 只允许只读 history 恢复；`completed` 直接返回既有 child。只有 `failed` 且 `provider_thread_id IS NULL` 时，用户显式重试才能把同一 operation 重新置为 `provider_pending`。

- [ ] **Step 5: 运行数据库测试和既有 history 回归**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backend::tests -- --nocapture`

Expected: PASS；原子回滚、配置继承、源历史不变和 Compact history round-trip 均通过。

- [ ] **Step 6: 提交持久化层**

```powershell
git add -- src-tauri/src/backend.rs
git commit -m "feat: persist recoverable thread fork operations"
```

### Task 4: 后端 Fork 编排、历史转换与幂等恢复 API

**Files:**
- Modify: `src-tauri/src/backend.rs`
- Modify: `src-tauri/src/agent_run.rs`（仅补齐 service 调用所需 crate API）
- Test: `src-tauri/src/backend.rs` 内联 API tests

- [ ] **Step 1: 写路由和完整状态机失败测试**

使用现有 router/临时数据库测试设施增加完整 API 测试，统一使用 `codex_thread_fork_` 前缀：

| 测试名 | 必须断言 |
| --- | --- |
| `codex_thread_fork_capability_derives_runtime_identity_from_source` | body 只允许 `refresh`；伪造 provider/session/cwd 字段返回 400；service 收到数据库快照 |
| `codex_thread_fork_prepares_record_before_provider_call` | mock service 被调用时数据库已存在 `provider_pending`；成功响应含 child summary、provider history 和 `loaded` |
| `codex_thread_fork_retry_finalizes_provider_succeeded_without_second_create` | 第一次 local finalize 失败，第二次复用 provider ID，Fork call count 始终为 1 |
| `codex_thread_fork_uncertain_uses_read_only_reconciliation` | zero/multiple 返回 409 且保持 `result_unknown`；unique 才绑定；三种情况 create count 均不增加 |
| `codex_thread_fork_restart_reconciles_stale_provider_pending` | 重建 AppState/打开同一 DB 后状态转 unknown，只发送 list/read，不发送 fork |
| `codex_thread_fork_history_pending_recovers_through_get_history` | child 先可见且 `historyLoaded=false`；后续 GET history 只读恢复并将 operation 置 completed |
| `codex_thread_fork_completed_retry_returns_same_child` | 重复相同 operation 返回同一 child 双 ID，不增加 Provider 请求或本地 thread 行 |

- [ ] **Step 2: 运行 API 测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::codex_thread_fork_ -- --nocapture`

Expected: FAIL，路由和编排 handler 尚不存在。

- [ ] **Step 3: 增加严格 API contract 和路由**

增加路由：

```rust
.route(
    "/api/projects/{project_id}/threads/{thread_id}/fork/capability",
    post(codex_thread_fork_capability),
)
.route(
    "/api/projects/{project_id}/threads/{thread_id}/fork",
    post(fork_codex_thread),
)
```

请求/响应：

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThreadForkCapabilityRequest { #[serde(default)] refresh: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThreadForkRequest { operation_id: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadForkResponse {
    ok: bool,
    operation_id: String,
    thread_id: String,
    thread: Value,
    history: Value,
    history_state: ThreadForkHistoryState,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum ThreadForkHistoryState { Loaded, Pending }
```

- [ ] **Step 4: 实现不跨 await 持有数据库锁的编排顺序**

Handler 固定按以下顺序：

1. 获取 workspace write lock，读取并校验 source/project，检查 runtime/operation 状态，写入或复用 operation，然后释放 connection 和锁。
2. capability handler 只调用 probe；Fork handler 根据 operation 状态选择 create、reconcile、finalize 或直接返回 completed child。遗留 `provider_pending` 在初始化阶段已转为 `result_unknown`，不能进入 create 分支。
3. Provider 结果返回后重新获取锁：先记录 provider ID，再执行本地 finalize。
4. `Unsupported/Rejected` 标记 failed；`Uncertain` 标记 result_unknown；`ProviderCreated` 先保存 provider ID，再走 history_pending finalize。
5. result_unknown 只调用 `reconcile_codex_thread_fork`：唯一候选继续；零/多候选保持 409，不再次调用 `thread/fork`。
6. `get_thread_history` 发现 child operation 为 history_pending 时，释放锁后通过源 actor 调用只读 `thread/read`，再原子写入 history；失败返回可重试错误，不复制源本地 messages。
7. 删除 source thread 前若存在 provider_pending/provider_succeeded/result_unknown/history_pending，返回 409，避免丢失恢复入口。

- [ ] **Step 5: 实现 Provider snapshot 到 ConversationTurn 的确定映射**

增加纯函数并直接测试：

```rust
fn codex_snapshot_to_conversation_turns(
    turns: &[CodexStoredTurn],
    provider_thread_id: &str,
    workspace: &str,
) -> Vec<Value>;
```

映射规则：

- ID 使用 `codex:{providerThreadId}:{providerTurnId}`，刷新/重试稳定。
- userMessage text 合并为 `userText` 并写 `userContentBlocks`；localImage 只保存 path/name；远程 image 只保存 `attachment_metadata`，不下载、不保存 base64。
- agentMessage text 进入 `assistantText` 和 text items；reasoning 不进入可见历史。
- Tool 转为 `ToolStep` 和 tool item，input/result 已经过协议层脱敏；completed/failed/declined 映射 done/error。
- 仅 contextCompaction 的 turn 转为现有 compact system-command 卡片，source=`automatic`、status=`completed`。
- provider turn 的 completed/interrupted/failed 分别映射 done/stopped/error；pending approval/user request 不复制。

- [ ] **Step 6: 运行后端定向与全量 Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork -- --nocapture`

Expected: PASS，包含协议、actor、DB、API 和历史转换用例。

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast`

Expected: 既有非鉴权测试全部 PASS；需凭证的既有 smoke 保持 ignored，不新增忽略项。

- [ ] **Step 7: 提交后端编排**

```powershell
git add -- src-tauri/src/backend.rs src-tauri/src/agent_run.rs
git commit -m "feat: orchestrate recoverable Codex thread forks"
```

### Task 5: 前端 Fork 领域模型与工作区原子接入

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/codex-thread-fork.ts`
- Create: `src/lib/codex-thread-fork.test.ts`
- Modify: `src/hooks/useWorkspaceState.ts`

- [ ] **Step 1: 写 availability 和新聊天归一化失败测试**

在 `src/lib/codex-thread-fork.test.ts` 使用 `node:test`、`node:assert/strict` 和完整的 `ThreadSummary`/`ThreadForkResponse` fixture 增加：

| 测试名 | 必须断言 |
| --- | --- |
| `fork availability reports every blocking reason` | 非 Codex=`仅 Codex 聊天支持在新聊天中继续`；无 session=`当前聊天尚未绑定 Codex 会话`；running=`当前聊天正在运行`；approval/input=`当前聊天正在等待确认或输入`；checking 禁用；unsupported 文案含升级 CLI；error 显示检查失败；forking=`正在创建新聊天`；supported+idle 返回 `{ enabled: true }` |
| `fork response creates an isolated loaded ThreadDetail` | local ID=`local-child`、session ID=`provider-child`、history turns 使用 response 数组；debug/raw 为空；`historyLoaded=true`；不读取 source fixture |
| `history-pending fork detail stays recoverable without source fallback` | `historyLoaded=false`、turns 为空、双 ID 仍保留，且 response 转换不接受 source turns 参数 |
| `fork capability key changes with trusted runtime identity` | provider/session/cwd/model/effort/permission/channel 任一变化都会改变 key；相同 summary 产生同 key |

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/codex-thread-fork.test.ts`

Expected: FAIL，模块和类型尚不存在。

- [ ] **Step 3: 增加集中类型和纯 helper**

在 `src/types.ts` 增加：

```ts
export type CodexThreadForkCapability = {
  state: 'checking' | 'supported' | 'unsupported' | 'error';
  message?: string;
};

export type ThreadForkAvailability = { enabled: boolean; reason?: string };

export type ThreadForkResponse = {
  ok: true;
  operationId: string;
  threadId: string;
  thread: ThreadSummary;
  history: ThreadHistoryPayload;
  historyState: 'loaded' | 'pending';
};
```

在新 helper 中导出：

```ts
export function threadForkCapabilityKey(thread: ThreadSummary): string;
export function getThreadForkAvailability(input: {
  thread: ThreadSummary;
  capability?: CodexThreadForkCapability;
  busy: boolean;
  pendingHumanRequest: boolean;
  forking: boolean;
}): ThreadForkAvailability;
export function threadDetailFromForkResponse(response: ThreadForkResponse): ThreadDetail;
```

禁用文案必须具体：仅 Codex、未绑定会话、正在运行、等待确认、正在检查能力、版本不支持需升级、能力检查失败、正在创建新聊天。

- [ ] **Step 4: 在 useWorkspaceState 中实现 capability 预取和 Fork 请求**

新增状态/引用：

```ts
const [threadForkCapabilities, setThreadForkCapabilities] = useState<Record<string, CodexThreadForkCapability>>({});
const [forkingThreadIds, setForkingThreadIds] = useState<string[]>([]);
const forkOperationIdsRef = useRef(new Map<string, string>());
```

新增并导出 hook actions：

```ts
async function prepareThreadFork(thread: ThreadSummary): Promise<void>;
async function forkThread(thread: ThreadSummary): Promise<ThreadSummary | null>;
```

要求：

- `prepareThreadFork` 先确保目标 thread history 已加载；未加载期间 availability 保持 checking，读取完成后才能判断 persisted approval/user-input。随后按 `threadForkCapabilityKey` 去重，POST capability，校验响应枚举；设置变更后重新检查。
- `forkThread` 对同一 source 复用 operation ID；请求期间去重；后端失败保持原聊天和 operation ID，成功才清除。
- 成功后一次更新项目 threads、`threadDetails`、active IDs 和 draft 状态；使用响应 history，不读取/复制 source detail。
- `historyState=pending` 时仍打开新聊天，但 `historyLoaded=false`，显示“历史将在重新读取后恢复”；现有 load history 流程负责重试。
- Provider 失败或结果未知只显示后端可见错误，不自动调用第二次 Fork。

- [ ] **Step 5: 运行前端领域测试、类型检查**

Run: `node --import tsx --test src/lib/codex-thread-fork.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS，无类型错误。

- [ ] **Step 6: 提交领域与工作区状态**

```powershell
git add -- src/types.ts src/lib/codex-thread-fork.ts src/lib/codex-thread-fork.test.ts src/hooks/useWorkspaceState.ts
git commit -m "feat: add Codex thread fork workspace state"
```

### Task 6: 顶部菜单与侧边栏右键入口

**Files:**
- Modify: `src/components/ChatHeader.tsx`
- Modify: `src/components/SidebarProjects.tsx`
- Modify: `src/App.tsx`
- Create: `src/lib/codex-thread-fork-ui.test.ts`

- [ ] **Step 1: 写两个入口和接线失败测试**

```ts
test('chat header exposes one capability-aware continue-in-new-chat action', () => {
  assert.match(headerSource, /MessageSquarePlus/);
  assert.match(headerSource, />在新聊天中继续</);
  assert.match(headerSource, /disabled=\{!threadForkAvailability\.enabled\}/);
  assert.match(headerSource, /threadForkAvailability\.reason/);
});

test('sidebar prepares capability on menu open and uses the same action contract', () => {
  assert.match(sidebarSource, /onPrepareThreadFork\(thread\)/);
  assert.match(sidebarSource, /onForkThread\(thread\)/);
  assert.match(sidebarSource, />在新聊天中继续</);
});

test('App derives busy and pending states without provider fallbacks', () => {
  assert.match(appSource, /getThreadForkAvailability/);
  assert.doesNotMatch(appSource, /copy.*turns|summary.*fork|createThread\(.*fork/is);
});
```

- [ ] **Step 2: 运行 UI 契约测试确认失败**

Run: `node --import tsx --test src/lib/codex-thread-fork-ui.test.ts`

Expected: FAIL，props、菜单项和 App 接线尚不存在。

- [ ] **Step 3: 扩展 ChatHeader 和 SidebarProjects props**

`ChatHeader` 增加：

```ts
threadForkAvailability: ThreadForkAvailability;
onForkThread: (thread: ThreadSummary) => void | Promise<void>;
```

在“重命名聊天”和“复制会话 ID”之间加入 `MessageSquarePlus` 菜单项。禁用时保留菜单打开，并用 `title={reason}` / `aria-label` 暴露原因；可用时关闭菜单再执行。

`SidebarProjects` 增加：

```ts
getThreadForkAvailability: (thread: ThreadSummary) => ThreadForkAvailability;
onPrepareThreadFork: (thread: ThreadSummary) => void | Promise<void>;
onForkThread: (thread: ThreadSummary) => void | Promise<void>;
```

`openThreadMenu` 找到目标 thread 后调用 `onPrepareThreadFork`；菜单使用同一标签、图标、availability 和 action。非 Codex 项保留可见但禁用，原因明确，不提供普通新聊天回退。

- [ ] **Step 4: 在 App 统一组合可用性**

App 从 `useWorkspaceState` 取得 capability/forking/actions，定义：

```ts
function resolveThreadForkAvailability(thread: ThreadSummary): ThreadForkAvailability {
  const detail = threadDetails[thread.id];
  return getThreadForkAvailability({
    thread,
    capability: threadForkCapabilities[threadForkCapabilityKey(thread)],
    busy: runningThreadIds.includes(thread.id) || Boolean(threadRuntimeStatuses[thread.id]?.activeRun),
    pendingHumanRequest: Boolean(detail?.turns.some((turn) =>
      turn.pendingApprovalRequests?.length || turn.pendingUserInputRequests?.length
    )),
    forking: forkingThreadIds.includes(thread.id),
  });
}
```

把同一个 resolver/action 传给顶部和侧边栏；顶部菜单打开时对 active thread 预取 capability。不要把 Fork 状态塞入 ConversationPane 或 Composer，避免无关重渲染。

- [ ] **Step 5: 运行 UI、菜单和多 Provider 回归**

Run: `node --import tsx --test src/lib/codex-thread-fork-ui.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/sidebar-thread-status.test.ts`

Expected: PASS；Claude/Grok/OpenCode/Pi 无 Fork 请求回退。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交 UI**

```powershell
git add -- src/components/ChatHeader.tsx src/components/SidebarProjects.tsx src/App.tsx src/lib/codex-thread-fork-ui.test.ts
git commit -m "feat: add continue in new chat actions"
```

### Task 7: 全量验证、真实桌面验收与 Trellis 收口

**Files:**
- Modify: `.trellis/tasks/codex-continue-in-new-chat.md`
- Modify: `.trellis/tasks/codex-capability-parity-roadmap.md`
- Modify: 实现开始时由 `.trellis/workspace/current-session.json` 指向的 session record

- [ ] **Step 1: 运行格式、前端全量测试、Rust 全量测试和生产构建**

Run:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' })
node --import tsx --test $testFiles
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast
git diff --check
```

Expected: 所有非鉴权测试 PASS、TypeScript 和构建 PASS、Rust 格式 PASS、diff 无空白错误；既有鉴权 smoke 可保持 ignored，但不能新增 ignore。

- [ ] **Step 2: 重启桌面开发模式**

停止本任务启动前已有的 CodeM desktop dev 壳，再运行：

Run: `npm run desktop:dev`

Expected: 新桌面壳启动，后台健康检查正常；不删除或暂存 `.tmp-dev/`。

- [ ] **Step 3: 执行真实桌面成功路径**

使用支持 `thread/fork` 的当前 Codex CLI：

1. 创建至少包含文本、工具调用、文件修改和 Compact 节点的会话。
2. 顶部菜单点击“在新聊天中继续”。
3. 核对新旧 CodeM thread ID 不同、session ID 不同；新聊天历史完整，原聊天不变。
4. 核对项目、cwd、Provider、模型、effort、权限、渠道和标题继承；队列、审批、debug/raw 不继承。
5. 从侧边栏右键重复一次，确认同一 action contract 和立即激活。

Expected: 两个入口成功；没有 WebView reload、重复聊天、错绑 ID 或控制台错误。

- [ ] **Step 4: 执行门禁、降级、恢复和长历史验收**

1. 在生成中、审批中、等待用户输入和 Compact 中打开两个菜单，确认禁用原因准确且无 Provider Fork 请求。
2. 用 method-not-found fixture 验证提示升级，不创建普通新聊天、不复制本地消息、不生成摘要。
3. 注入 Provider 成功/本地 finalize 失败，重启后重试，确认 Provider Fork 计数仍为 1。
4. 注入 timeout/result_unknown，确认 zero/multiple candidate 不自动重试；unique candidate 才绑定。
5. 注入 history read 失败，确认 child 双 ID 保留；再次加载 history 后只读恢复。
6. 用 200-turn 会话 Fork，确认仍只渲染当前可见窗口，切换/刷新无明显卡顿。

Expected: 失败路径可解释、可恢复、不重复；长历史 DOM 数量沿用现有窗口边界。

- [ ] **Step 5: 写回 Trellis**

依次运行：

```powershell
$implementationSessionRecord = (Get-Content -Raw '.trellis/workspace/current-session.json' | ConvertFrom-Json).sessionPath
npm run trellis -- record "完成 Codex 在新聊天中继续实现：原生完整会话 Fork、双 ID、本地事务、幂等恢复和双入口。"
$codexVersion = codex --version
$verificationEvidence = "cargo fmt、前端全量测试、typecheck、build、Rust 全量测试和 git diff --check 均通过；Codex CLI=$codexVersion；顶部菜单、侧边栏、门禁、重启恢复、结果未知、history pending 和 200-turn 桌面路径均通过。"
npm run trellis -- verify "全量自动化与真实桌面 Fork 验收" --result $verificationEvidence
npm run trellis -- complete --summary "完成 P0-3 Codex 原生完整会话 Fork、双入口、双 ID、配置继承和幂等恢复；P0-4 Archive 未实现；未按本计划自动推送远端。"
```

命令前必须确认 `$verificationEvidence` 中列出的每项确实通过；任一项未通过时，改为记录实际失败项并且不得执行 `complete`。将 P0-3 验收项标记为完成；P0-4 Archive 仍保持未完成。

- [ ] **Step 6: 最终提交**

```powershell
git add -- .trellis/tasks/codex-continue-in-new-chat.md .trellis/tasks/codex-capability-parity-roadmap.md $implementationSessionRecord
git commit -m "docs: record Codex thread fork acceptance"
```

提交前执行 `git diff --cached --name-only`，确认不包含 `.tmp-dev/` 或无关用户文件。除非用户另行要求，本计划不推送远端。

## Execution Order And Stop Conditions

- 严格按 Task 1 → 7 执行；Task 1-4 后端契约通过前，不接 UI。
- 每个 Task 都先看到新测试因缺少行为而失败，再写最小实现使其通过；不得把红灯归因于既有失败而跳过。
- 若当前 Codex CLI 的真实 schema 与官方文档在 `thread/fork`、`forkedFromId` 或 stored item shape 上不同，停止编码，先把实测 JSON 形状和兼容决定写回主任务。
- 若实现需要复制源 CodeM messages 才能显示历史，停止并回到设计；这违反已确认的 Provider 历史来源约束。
- 若 Provider 成功但无法获得新 thread ID，必须保持 result_unknown；不得自动再调用 `thread/fork`。
- 任一改动开始影响 Archive、指定轮次 Fork 或其他 Provider 时停止扩展，留作独立任务。
