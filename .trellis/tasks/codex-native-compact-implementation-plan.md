# Codex 原生会话压缩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex Provider 接入原生 `thread/compact/start`，让手动与自动压缩具备能力探测、严格串行、结构化历史、失败恢复和重启核对能力，同时保持 Claude `/compact` 与普通 Agent 队列行为不变。

**Architecture:** Rust 的 `CodexConnection` 负责协议探测、原生 compact 生命周期和只读历史核对；`agent_run` 把 Compact 作为现有 thread actor 的一等命令，并通过专用 NDJSON 接口向前端发结构化事件。React 侧由 `useAgentRun` 按 CodeM thread ID 维护 compact coordinator 和队列屏障，系统事件 turn 复用现有历史 JSON 持久化，不新增 SQLite 表。

**Tech Stack:** React 19、TypeScript、Rust、Axum、Tokio、Tauri、Codex App Server JSON-RPC

---

## 文件职责与改动地图

- `src-tauri/src/codex_app_server.rs`：Codex experimental capability probe、`thread/compact/start` 生命周期聚合、`thread/read` 只读核对和 JSONL mock 协议测试。
- `src-tauri/src/agent_runtime.rs`：跨层稳定的 compact capability、status 和 runtime event 序列化类型。
- `src-tauri/src/agent_run.rs`：能力缓存、compact/reconcile 路由、runtime actor 的 Compact 命令、session/workspace/channel 校验和后端防重。
- `src/types.ts`：前端 compact capability、operation metadata、system turn 和 runtime event 类型。
- `src/lib/codex-compact.ts`：创建、查找、原位更新 compact 卡片以及入口禁用原因的纯函数。
- `src/lib/codex-compact.test.ts`：compact 状态机、重复事件、跨 thread 隔离、恢复和禁用态单元测试。
- `src/lib/queued-prompts.ts`：在普通队列调度前增加 compact 屏障判定。
- `src/lib/queued-prompts.test.ts`：`turn -> compact -> queued prompt` 顺序、失败暂停、重试和跳过回归测试。
- `src/hooks/useAgentRun.ts`：能力读取、manual/automatic compact coordinator、专用事件流、重试/跳过、队列释放和重启核对。
- `src/App.tsx`：把 Codex `/compact` 改接原生入口，保留 Claude 的旧提交路径；向 Composer 和 ConversationPane 下发 compact actions。
- `src/components/Composer.tsx`：把统一 compact availability/action 传给上下文用量弹层。
- `src/components/ComposerContextIndicator.tsx`：增加“压缩上下文”按钮、禁用理由和执行中状态。
- `src/components/ConversationPane.tsx`：向 compact 系统卡片透传 retry/skip 动作。
- `src/components/ConversationTurn.tsx`：system turn 专用布局、compact 状态文案、重试图标与“跳过并继续”。
- `src/styles.css`：复用主题变量补充紧凑 compact 卡片和上下文按钮样式。
- `src-tauri/src/backend.rs`：同时负责 `/compact` 的 Codex 命令 scope，以及 history JSON round-trip。
- `src/lib/slash-command-filter.test.ts`：确认 Codex 能看见 builtin `/compact`，其他 Claude 专属命令不被误开放。
- `src/lib/conversation.ts`、`src/lib/conversation.test.ts`：旧 history 的 `kind` 兼容修复、系统 turn 归一化和持久化前中断态保护。
- `src-tauri/src/backend.rs`：在现有 messages JSON round-trip 中推导并恢复 `ConversationTurn.kind='system'`，不做 schema migration。

## 固定协议与状态约定

以下命名在所有任务中保持一致，不在实现阶段另起同义类型：

```ts
export type CodexCompactCapabilityState =
  | 'unknown'
  | 'checking'
  | 'supported'
  | 'unsupported'
  | 'error';

export type CompactSource = 'manual' | 'automatic';
export type CompactOperationStatus =
  | 'waiting'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';
export type CompactResolution = 'skipped';
```

后端只发送 `supported | unsupported | error`；`unknown | checking` 只属于前端请求状态。统一 runtime event 名称为 `context-compaction`，manual compact 事件流最终仍以现有 `done` 或 `error` 结束，避免把 automatic compact 的 completed 事件错误当成普通 turn 的 terminal event。

### Task 1: Codex capability probe 与原生 compact 生命周期

**Files:**
- Modify: `src-tauri/src/codex_app_server.rs`
- Test: `src-tauri/src/codex_app_server.rs` 内 `#[cfg(test)]` 模块

- [ ] **Step 1: 写 capability probe 的失败测试**

在现有 `mock_connection()` 测试设施旁新增三个 JSONL 测试，固定错误码判定：

```rust
#[tokio::test]
async fn compact_probe_maps_invalid_params_to_supported() {
    let (mut connection, mut lines, mut writer) = mock_connection();
    let client = tokio::spawn(async move { connection.probe_compact_capability().await });

    let request = read_wire(&mut lines).await;
    assert_eq!(request["method"], "thread/compact/start");
    assert_eq!(request["params"], json!({}));
    write_wire(&mut writer, json!({
        "id": request["id"],
        "error": { "code": -32602, "message": "missing field threadId" }
    })).await;

    assert_eq!(
        client.await.expect("probe task").expect("probe result"),
        CodexCompactCapability::Supported,
    );
}

#[tokio::test]
async fn compact_probe_maps_method_not_found_to_unsupported() {
    let (mut connection, mut lines, mut writer) = mock_connection();
    let client = tokio::spawn(async move { connection.probe_compact_capability().await });
    let request = read_wire(&mut lines).await;
    write_wire(&mut writer, json!({
        "id": request["id"],
        "error": { "code": -32601, "message": "method not found" }
    })).await;
    assert_eq!(
        client.await.expect("probe task").expect("probe result"),
        CodexCompactCapability::Unsupported,
    );
}

#[tokio::test]
async fn compact_probe_preserves_unexpected_rpc_errors() {
    let (mut connection, mut lines, mut writer) = mock_connection();
    let client = tokio::spawn(async move { connection.probe_compact_capability().await });
    let request = read_wire(&mut lines).await;
    write_wire(&mut writer, json!({
        "id": request["id"],
        "error": { "code": -32603, "message": "internal error" }
    })).await;
    assert!(matches!(
        client.await.expect("probe task"),
        Err(CodexAppServerError::Rpc { code: -32603, .. })
    ));
}
```

- [ ] **Step 2: 运行 probe 测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compact_probe -- --nocapture`

Expected: FAIL，编译器报告 `CodexCompactCapability` 或 `probe_compact_capability` 尚未定义。

- [ ] **Step 3: 实现无副作用 probe**

在 `CodexAppServerError` 附近新增：

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodexCompactCapability {
    Supported,
    Unsupported,
}
```

在 `CodexConnection` 和 `CodexStdioClient` 分别增加同名方法，connection 的完整判定为：

```rust
pub async fn probe_compact_capability(
    &mut self,
) -> Result<CodexCompactCapability, CodexAppServerError> {
    match self
        .request("thread/compact/start", json!({}), REQUEST_TIMEOUT)
        .await
    {
        Err(CodexAppServerError::Rpc { code: -32602, .. }) => {
            Ok(CodexCompactCapability::Supported)
        }
        Err(CodexAppServerError::Rpc { code: -32601, .. }) => {
            Ok(CodexCompactCapability::Unsupported)
        }
        Ok(_) => Err(CodexAppServerError::Protocol(
            "thread/compact/start 缺少 threadId 时意外成功".to_string(),
        )),
        Err(error) => Err(error),
    }
}
```

- [ ] **Step 4: 写 lifecycle 聚合的失败测试**

新增测试 `compact_waits_for_context_item_and_successful_terminal_turn`：请求空响应后先断言 task 未完成，再依次发送 `turn/started`、`item/started(contextCompaction)`、`item/completed(contextCompaction)` 和 `turn/completed(completed)`，最终断言 outcome 同时包含 `turn-compact-1` 与 `compact-item-1`。再新增 `compact_rejects_completed_turn_without_context_item`、`compact_reports_failed_terminal_turn` 和 `compact_deduplicates_deprecated_thread_compacted`。

```rust
let outcome = client.await.expect("compact task").expect("compact outcome");
assert_eq!(outcome.provider_thread_id, "thread-1");
assert_eq!(outcome.provider_turn_id, "turn-compact-1");
assert_eq!(outcome.provider_item_id, "compact-item-1");
assert!(observed.iter().any(|event| matches!(
    event,
    CodexCompactionEvent::Started { provider_item_id, .. }
        if provider_item_id.as_deref() == Some("compact-item-1")
)));
assert!(observed.iter().any(|event| matches!(
    event,
    CodexCompactionEvent::Completed { provider_item_id, .. }
        if provider_item_id == "compact-item-1"
)));
```

- [ ] **Step 5: 运行 lifecycle 测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compact_ -- --nocapture`

Expected: FAIL，缺少 `CodexCompactionEvent`、`CodexCompactionOutcome` 和 `start_compaction`。

- [ ] **Step 6: 实现 compact request 和生命周期聚合**

新增有界公开类型：

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodexCompactionEvent {
    Started {
        provider_turn_id: Option<String>,
        provider_item_id: Option<String>,
    },
    Completed {
        provider_turn_id: String,
        provider_item_id: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexCompactionOutcome {
    pub provider_thread_id: String,
    pub provider_turn_id: String,
    pub provider_item_id: Option<String>,
}
```

`start_compaction` 必须用 `send_request` 发送真实 thread ID，并在同一个读取循环中处理 response、request 和
notification；不能直接调用会忽略非目标消息的 `request/wait_for_response`。它在 `COMPACT_TIMEOUT` 内同时观察
completed `contextCompaction` item 与 status=`completed` 的 terminal turn。RPC 空响应只记录 accepted；
`thread/compacted` 仅在尚未观察新 item 时作为兼容信号，且按可用的 `(threadId, turnId, itemId)` 去重；
兼容路径允许 `provider_item_id=None`。turn status 为 `failed`、`interrupted`、子进程关闭或超时均返回错误，
不生成成功 outcome。

同时让普通 `run_turn` 的 notification parser 识别 `contextCompaction` item：item started 时发出
`CodexRuntimeEvent::CompactionStarted`；item completed 只记录 provider item ID，必须等同一 turn 的
`turn/completed(status=completed)` 到达后才发出 `CodexRuntimeEvent::CompactionCompleted`。不要在 item completed
时提前宣告完成，也不改变普通 turn 的 terminal 判定；Task 6 的 mapper会把这条路径标记为 automatic。

- [ ] **Step 7: 运行 Codex targeted tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compact_ -- --nocapture`

Expected: PASS，至少包含 7 个 compact probe/lifecycle 用例。

- [ ] **Step 8: 提交协议层**

```powershell
git add -- src-tauri/src/codex_app_server.rs
git commit -m "feat: add Codex compact protocol lifecycle"
```

### Task 2: 稳定 compact runtime event 与能力响应类型

**Files:**
- Modify: `src-tauri/src/agent_runtime.rs`
- Modify: `src/types.ts`
- Test: `src-tauri/src/agent_runtime.rs` 内测试模块

- [ ] **Step 1: 写 Rust 序列化失败测试**

```rust
#[test]
fn context_compaction_event_uses_stable_camel_case_contract() {
    let event = AgentRunEvent::ContextCompaction {
        run_id: "run-1".to_string(),
        operation_id: Some("compact-1".to_string()),
        source: AgentCompactionSource::Manual,
        status: AgentCompactionStatus::Running,
        provider_thread_id: "provider-thread-1".to_string(),
        provider_turn_id: Some("provider-turn-1".to_string()),
        provider_item_id: Some("provider-item-1".to_string()),
        error: None,
        at_ms: 1_754_000_000_000,
    };

    assert_eq!(serde_json::to_value(event).expect("serialize"), json!({
        "type": "context-compaction",
        "runId": "run-1",
        "operationId": "compact-1",
        "source": "manual",
        "status": "running",
        "providerThreadId": "provider-thread-1",
        "providerTurnId": "provider-turn-1",
        "providerItemId": "provider-item-1",
        "atMs": 1754000000000_i64
    }));
}
```

- [ ] **Step 2: 运行序列化测试并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml context_compaction_event_uses_stable_camel_case_contract`

Expected: FAIL，缺少 compact event 类型。

- [ ] **Step 3: 增加 Rust contract**

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactionSource {
    Manual,
    Automatic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactionStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCompactCapabilityState {
    Supported,
    Unsupported,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompactCapabilitySummary {
    pub state: AgentCompactCapabilityState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
```

向 `AgentRunEvent` 加入固定字段的 `ContextCompaction` 变体；不要把它加入 `is_terminal_event`，manual compact 流使用随后到达的 `Done/Error` 终结。

- [ ] **Step 4: 增加完全同构的 TypeScript contract**

```ts
export type CompactOperationMetadata = {
  operationId: string;
  source: CompactSource;
  status: CompactOperationStatus;
  attempt: number;
  resolution?: CompactResolution;
  providerThreadId: string;
  providerTurnId?: string;
  providerItemId?: string;
  requestedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  error?: string;
};

export type CodexCompactCapability = {
  state: CodexCompactCapabilityState;
  message?: string;
};
```

`AgentRunEvent` 增加 `context-compaction`；`SystemCommandItem` 增加 `compact?: CompactOperationMetadata`；`ConversationTurn` 增加 `kind?: 'message' | 'system'`；`SystemCommandItem.state` 扩展为 `'waiting' | 'running' | 'done' | 'error'`。旧 JSON 缺少这些字段时仍可读取。

- [ ] **Step 5: 验证 Rust 与 TypeScript contract**

Run: `cargo test --manifest-path src-tauri/Cargo.toml context_compaction_event_uses_stable_camel_case_contract`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS；现有 event switch 通过 default/terminal helper 保持兼容。

- [ ] **Step 6: 提交跨层 contract**

```powershell
git add -- src-tauri/src/agent_runtime.rs src/types.ts
git commit -m "feat: define compact runtime contract"
```

### Task 3: Compact actor 命令、专用 API 与后端防重

**Files:**
- Modify: `src-tauri/src/agent_run.rs`
- Modify: `src-tauri/src/codex_app_server.rs`
- Test: `src-tauri/src/agent_run.rs` 内测试模块

- [ ] **Step 1: 写 actor 调度失败测试**

新增以下独立行为测试：

```rust
fn test_codex_runtime_config() -> AgentRuntimeConfig {
    let mut config = test_runtime_config();
    config.provider_id = OPENAI_CODEX_PROVIDER_ID.to_string();
    config.driver = AgentDriverKind::CodexAppServer;
    config
}

fn insert_test_codex_runtime(
    state: &AgentRunState,
    phase: AgentRuntimePhase,
    current_run_id: Option<&str>,
    command: mpsc::UnboundedSender<AgentRuntimeCommand>,
) {
    let (shutdown, _shutdown_receiver) = watch::channel(false);
    state.runtimes.lock().expect("runtime lock").insert(
        "thread-1".to_string(),
        AgentRuntimeRecord {
            runtime_id: "runtime-1".to_string(),
            config: test_codex_runtime_config(),
            session_id: Some("provider-thread-1".to_string()),
            phase,
            current_run_id: current_run_id.map(ToString::to_string),
            command: Some(command),
            shutdown,
            last_error: None,
        },
    );
}

#[test]
fn hot_codex_runtime_dispatches_compact_over_existing_actor() {
    let state = test_run_state();
    let config = test_codex_runtime_config();
    let (command, mut commands) = mpsc::unbounded_channel();
    insert_test_codex_runtime(&state, AgentRuntimePhase::Ready, None, command);

    state.dispatch_compact(
        "thread-1".to_string(),
        config,
        "provider-thread-1".to_string(),
        AgentRuntimeCompact { run_id: "run-compact-1".to_string(), operation_id: "compact-1".to_string() },
    ).expect("dispatch compact");

    assert!(matches!(
        commands.try_recv(),
        Ok(AgentRuntimeCommand::Compact(AgentRuntimeCompact { operation_id, .. }))
            if operation_id == "compact-1"
    ));
}

#[test]
fn backend_rejects_compact_while_thread_operation_is_active() {
    let state = test_run_state();
    let (command, _commands) = mpsc::unbounded_channel();
    insert_test_codex_runtime(
        &state,
        AgentRuntimePhase::Running,
        Some("run-1"),
        command,
    );
    let error = state.dispatch_compact(
        "thread-1".to_string(),
        test_codex_runtime_config(),
        "provider-thread-1".to_string(),
        AgentRuntimeCompact { run_id: "run-compact-2".to_string(), operation_id: "compact-2".to_string() },
    ).expect_err("duplicate operation must fail");
    assert_eq!(error.status, StatusCode::CONFLICT);
}
```

再覆盖 provider 不是 Codex、sessionId 缺失、runtime resume 后返回不同 sessionId、workspace/config/channel 不一致四类拒绝路径。

- [ ] **Step 2: 运行 actor tests 并确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compact -- --nocapture`

Expected: FAIL，`AgentRuntimeCommand::Compact` 与 `dispatch_compact` 不存在。

- [ ] **Step 3: 把 actor 首个工作项泛化为 command**

将 `run_agent_runtime_actor` 的 `first_run: AgentRuntimeRun` 参数调整为
`first_command: AgentRuntimeCommand`，并使用同一个串行循环：

```rust
enum AgentRuntimeCommand {
    Run(AgentRuntimeRun),
    Compact(AgentRuntimeCompact),
}

struct AgentRuntimeCompact {
    run_id: String,
    operation_id: String,
}

fn command_run_id(command: &AgentRuntimeCommand) -> &str {
    match command {
        AgentRuntimeCommand::Run(run) => &run.run_id,
        AgentRuntimeCommand::Compact(compact) => &compact.run_id,
    }
}
```

actor 每次只处理一个 command。`Compact` 分支只接受 `LiveAgentRuntime::Codex`，先发
`preparing` 对应的 Status，再以当前 `session_id` 调用 `client.start_compaction`。观察到
started/completed 时分别发送 `ContextCompaction(status=running/completed)`，随后发 `Done`；任何错误先发
`ContextCompaction(status=failed,error=bounded)`，再发 `Error`。RPC 在 accepted 前明确拒绝、或已收到同步的
failed terminal turn，属于 non-fatal，runtime 可回到 Ready；超时、stdout 关闭、协议错位和子进程退出属于
fatal，必须关闭连接并把 runtime 标记 Failed，避免下一条消息读取到过期 compact 通知。

- [ ] **Step 4: 提取一致的 Codex runtime config 解析**

把 run handler 中 channel/runtime 解析提取成仅返回非敏感 config 的 helper，普通 run 与 compact 共用。
compact handler 使用以下完整解析边界：

```rust
fn resolve_compact_runtime_config(
    state: &AgentRunState,
    thread_id: &str,
    request: &StartAgentCompactRequest,
) -> AgentApiResult<AgentRuntimeConfig> {
    let working_directory = resolve_working_directory(&request.working_directory)?;
    let permission_mode = normalize_agent_permission_mode(request.permission_mode.as_deref())
        .ok_or_else(|| AgentApiError::bad_request(
            "permissionMode 仅支持 default、auto 或 bypassPermissions",
        ))?;
    let requested_model = normalize_optional_id(request.model.clone(), "model")?;
    let requested_channel_id = normalize_optional_id(request.channel_id.clone(), "channelId")?;
    let channel_runtime = state.agent_channels.resolve_runtime(
        OPENAI_CODEX_PROVIDER_ID,
        requested_channel_id.as_deref(),
        requested_model.as_deref(),
        Some(thread_id),
        Some(&request.session_id),
    ).map_err(AgentApiError::bad_request)?;
    Ok(AgentRuntimeConfig {
        provider_id: OPENAI_CODEX_PROVIDER_ID.to_string(),
        driver: AgentDriverKind::CodexAppServer,
        command: resolve_agent_command(state, OPENAI_CODEX_PROVIDER_ID, false)
            .ok_or_else(|| AgentApiError::bad_request("未找到 codex 命令"))?,
        working_directory,
        permission_mode,
        model: channel_runtime.as_ref()
            .and_then(|runtime| runtime.effective_model.clone())
            .or(requested_model),
        reasoning_effort: normalize_optional_id(
            request.reasoning_effort.clone(),
            "reasoningEffort",
        )?,
        channel_id: channel_runtime.as_ref().map(|runtime| runtime.channel_id.clone()),
        channel_fingerprint: channel_runtime.as_ref().map(|runtime| runtime.fingerprint.clone()),
        environment: channel_runtime.as_ref().map(|runtime| runtime.env.clone()).unwrap_or_default(),
        codex_config_args: channel_runtime.as_ref()
            .map(|runtime| runtime.codex_config_args.clone())
            .unwrap_or_default(),
        bridge_version: None,
    })
}
```

helper 不把 environment、token 或 config args写入事件和错误正文。

- [ ] **Step 5: 新增专用 compact 路由**

路由固定为：

```rust
.route(
    "/api/agents/runtime/{thread_id}/compact",
    post(start_agent_compact),
)
```

请求体：

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartAgentCompactRequest {
    operation_id: String,
    provider_id: String,
    session_id: String,
    working_directory: String,
    permission_mode: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    channel_id: Option<String>,
}
```

handler 校验 path thread ID、provider=`openai-codex`、非空 operation/session、工作目录归属和 config；创建独立 `AgentRunRecord` 后交给 `dispatch_compact`，返回现有 `build_event_stream`。同一 thread 的 active turn/compact 均返回 HTTP 409，不依赖前端防重。

- [ ] **Step 6: 运行后端 targeted tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::hot_codex_runtime_dispatches_compact_over_existing_actor -- --exact`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::backend_rejects_compact_while_thread_operation_is_active -- --exact`

Expected: PASS。

- [ ] **Step 7: 提交 actor 与 API**

```powershell
git add -- src-tauri/src/agent_run.rs src-tauri/src/codex_app_server.rs
git commit -m "feat: serialize compact in agent runtime"
```

### Task 4: Compact 卡片纯函数与系统 turn 数据模型

**Files:**
- Create: `src/lib/codex-compact.ts`
- Create: `src/lib/codex-compact.test.ts`
- Modify: `src/lib/conversation.ts`
- Test: `src/lib/conversation.test.ts`

- [ ] **Step 1: 写纯函数失败测试**

覆盖创建、原位更新、重复 completed 去重、错误裁剪、不同 thread 的 operation ID 不串写、旧数据修复：

```ts
test('createManualCompactTurn creates one system turn without a fake user message', () => {
  const turn = createManualCompactTurn({
    operationId: 'compact-1',
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'waiting',
    nowMs: 100,
  });
  assert.equal(turn.kind, 'system');
  assert.equal(turn.userText, '');
  assert.equal(turn.items.length, 1);
  assert.equal(turn.items[0]?.type, 'system-command');
  assert.equal(turn.items[0]?.type === 'system-command' ? turn.items[0].compact?.status : '', 'waiting');
});

test('applyCompactEvent updates the existing card and preserves sibling turn identities', () => {
  const before = [textTurn('turn-1'), compactTurn('compact-1'), textTurn('turn-2')];
  const after = applyCompactEvent(before, completedEvent('compact-1'));
  assert.equal(after[0], before[0]);
  assert.notEqual(after[1], before[1]);
  assert.equal(after[2], before[2]);
  assert.equal(readCompactMetadata(after[1])?.status, 'completed');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --import tsx --test src/lib/codex-compact.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现 compact 纯函数**

导出以下固定 API：

```ts
type ContextCompactionEvent = Extract<AgentRunEvent, { type: 'context-compaction' }>;

type CreateManualCompactTurnInput = {
  operationId: string;
  providerThreadId: string;
  workspace: string;
  status: Extract<CompactOperationStatus, 'waiting' | 'preparing'>;
  nowMs: number;
};

export type CompactAvailabilityInput = {
  providerId: string;
  sessionId?: string;
  capability: CodexCompactCapability;
  activeStatus?: CompactOperationStatus;
};

export type CompactAvailability = {
  available: boolean;
  busy: boolean;
  reason: string;
};

export function createManualCompactTurn(input: CreateManualCompactTurnInput): ConversationTurn;
export function createAutomaticCompactTurn(event: ContextCompactionEvent, workspace: string): ConversationTurn;
export function readCompactMetadata(turn: ConversationTurn): CompactOperationMetadata | null;
export function findPendingCompactTurn(turns: ConversationTurn[]): ConversationTurn | null;
export function applyCompactEvent(turns: ConversationTurn[], event: ContextCompactionEvent): ConversationTurn[];
export function retryCompactTurn(turn: ConversationTurn, nowMs: number): ConversationTurn;
export function skipCompactTurn(turn: ConversationTurn, nowMs: number): ConversationTurn;
export function interruptUnconfirmedCompactTurn(turn: ConversationTurn, nowMs: number): ConversationTurn;
export function getCompactAvailability(input: CompactAvailabilityInput): CompactAvailability;
```

测试文件使用以下自包含 fixtures，不依赖未声明 helper：

```ts
function textTurn(id: string): ConversationTurn {
  return {
    id,
    userText: 'message',
    workspace: 'D:/workspace',
    assistantText: 'answer',
    tools: [],
    items: [{ id: `${id}-text`, type: 'text', text: 'answer' }],
    status: 'done',
  };
}

function compactTurn(operationId: string): ConversationTurn {
  return createManualCompactTurn({
    operationId,
    providerThreadId: 'provider-thread-1',
    workspace: 'D:/workspace',
    status: 'preparing',
    nowMs: 100,
  });
}

function completedEvent(operationId: string): ContextCompactionEvent {
  return {
    type: 'context-compaction',
    runId: 'run-compact-1',
    operationId,
    source: 'manual',
    status: 'completed',
    providerThreadId: 'provider-thread-1',
    providerTurnId: 'provider-turn-1',
    providerItemId: 'provider-item-1',
    atMs: 200,
  };
}
```

`applyCompactEvent` 只复制命中的 turn 与 item；provider item/turn ID 相同的重复事件返回原数组。错误正文先删除疑似 token/环境赋值，再限制为 2,000 字符。manual event 必须按 operation ID 关联；没有活动 manual operation 时才创建 automatic turn，禁止按时间或 token 阈值猜来源。

- [ ] **Step 4: 增加旧 history 修复**

在 `repairConversationTurn` 中只做兼容推导，并把 `kind` 纳入 early-return 与最终返回对象：

```ts
const kind = turn.kind ?? (
  turn.userText.trim() === '' &&
  turn.items.length === 1 &&
  turn.items[0]?.type === 'system-command' &&
  Boolean(turn.items[0].compact)
    ? 'system'
    : 'message'
);

if (
  repairedItems === turn.items &&
  assistantText === turn.assistantText &&
  kind === turn.kind
) {
  return turn;
}

return Object.assign({}, turn, {
  kind,
  assistantText,
  items: repairedItems,
  tools: toolsChanged ? repairedTools : turn.tools,
});
```

`normalizeTurnsForPersist` 对 waiting/preparing/running compact 不调用普通 `closeTurnWithoutTerminalEvent`，而是转为 `interrupted`，确保应用关闭时保存的事实不会伪装成 done。

- [ ] **Step 5: 运行纯函数与历史测试**

Run: `node --import tsx --test src/lib/codex-compact.test.ts src/lib/conversation.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交前端 compact domain**

```powershell
git add -- src/lib/codex-compact.ts src/lib/codex-compact.test.ts src/lib/conversation.ts src/lib/conversation.test.ts
git commit -m "feat: add compact timeline state model"
```

### Task 5: 队列屏障、失败暂停、重试与跳过

**Files:**
- Modify: `src/lib/queued-prompts.ts`
- Modify: `src/lib/queued-prompts.test.ts`
- Modify: `src/hooks/useAgentRun.ts`

- [ ] **Step 1: 写队列优先级失败测试**

```ts
test('compact barrier runs before a ready queued prompt', () => {
  assert.equal(
    getQueuedPromptContinuationState([{ queueStatus: 'ready' }], 'waiting'),
    'blocked-by-compact',
  );
  assert.equal(
    getQueuedPromptContinuationState([{ queueStatus: 'ready' }], 'completed'),
    'ready',
  );
});

test('failed compact keeps the queue paused until skipped or retried', () => {
  assert.equal(getQueuedPromptContinuationState([{ queueStatus: 'ready' }], 'failed'), 'blocked-by-compact');
  assert.equal(getQueuedPromptContinuationState([{ queueStatus: 'ready' }], undefined), 'ready');
});
```

再增加 `preparing/running/interrupted`、空队列、guide-unknown 与 compact 同时存在的用例；compact 屏障优先于 ready/preparing/guiding 状态。

- [ ] **Step 2: 运行队列测试并确认失败**

Run: `node --import tsx --test src/lib/queued-prompts.test.ts`

Expected: FAIL，函数尚不接受 compact status，返回联合类型缺少 `blocked-by-compact`。

- [ ] **Step 3: 实现纯队列判定**

```ts
export function getQueuedPromptContinuationState(
  queue: QueuedPromptContinuationCandidate[],
  compactStatus?: CompactOperationStatus,
): 'empty' | 'preparing' | 'paused' | 'blocked-by-compact' | 'ready' {
  if (compactStatus && compactStatus !== 'completed') {
    return 'blocked-by-compact';
  }
  if (queue.some((prompt) => prompt.queueStatus === 'guide-unknown')) {
    return 'paused';
  }
  const headStatus = queue[0]?.queueStatus;
  if (!headStatus) return 'empty';
  if (headStatus === 'preparing') return 'preparing';
  if (headStatus === 'guiding') return 'paused';
  return 'ready';
}
```

completed 卡片由 coordinator 在释放前从 active barrier map 移除，因此调用时也允许传 `undefined`；failed/interrupted 只有 retry 或 skip 才能解除。

- [ ] **Step 4: 在 hook 建立按 thread 隔离的控制屏障**

新增 refs：

```ts
const compactOperationsByThreadIdRef = useRef(new Map<string, CompactOperationContext>());
const pausedQueueAfterCompactByThreadIdRef = useRef(new Map<string, AgentRunContext>());
```

普通 turn 的 done 分支顺序固定：

```ts
if (event.type === 'done' && !context.cancelRequested) {
  if (!maybeStartPendingCompaction(context)) {
    maybeStartQueuedPrompt(context);
  }
}
```

`maybeStartQueuedPrompt` 首先读取该 thread compact status；返回 `blocked-by-compact` 时保存 continuation 而不 shift queue。compact completed 删除 barrier 并调用 `maybeStartQueuedPrompt`；failed/interrupted 保留 barrier；skip 把卡片 resolution 写为 skipped、删除 barrier、再继续原 queue。retry 复用 operation/card，attempt+1，不创建第二张卡。

- [ ] **Step 5: 运行队列与 typecheck**

Run: `node --import tsx --test src/lib/queued-prompts.test.ts src/lib/codex-compact.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交队列屏障**

```powershell
git add -- src/lib/queued-prompts.ts src/lib/queued-prompts.test.ts src/hooks/useAgentRun.ts
git commit -m "feat: gate prompt queue on Codex compact"
```

### Task 6: 能力缓存、manual 请求流与 automatic compact 接入

**Files:**
- Modify: `src-tauri/src/agent_run.rs`
- Modify: `src/hooks/useAgentRun.ts`
- Modify: `src/types.ts`
- Test: `src-tauri/src/agent_run.rs` 内测试模块
- Test: `src/lib/codex-compact.test.ts`

- [x] **Step 1: 写能力缓存与 API 失败测试**

测试同一 `command + channelFingerprint + codexConfigArgs` 只启动一次 probe；refresh=true 或 key 改变会重新探测；unexpected RPC error 返回 `{state:'error'}` 且 message 经过公共错误裁剪。

```rust
#[test]
fn compact_capability_cache_key_changes_with_channel_runtime() {
    let mut first = test_codex_runtime_config();
    first.channel_fingerprint = Some("channel-a".to_string());
    let mut second = first.clone();
    second.channel_fingerprint = Some("channel-b".to_string());
    assert_ne!(compact_capability_cache_key(&first), compact_capability_cache_key(&second));
}
```

- [x] **Step 2: 实现进程内 capability cache 和 route**

`AgentRunState` 增加：

```rust
compact_capability_cache: Arc<Mutex<HashMap<String, AgentCompactCapabilitySummary>>>,
```

路由固定为 `POST /api/agents/codex/compact-capability`，请求携带 CodeM threadId、sessionId、workingDirectory、channelId/model/reasoningEffort 和 `refresh`。handler 复用 Task 3 的 config 解析，缓存只在进程内；supported/unsupported 可缓存，error 不跨请求永久锁死。unsupported message 固定为“当前 Codex CLI 不支持原生会话压缩，请升级 Codex CLI。”

- [x] **Step 3: 在 hook 实现 capability 状态**

按 runtime key 维护：

```ts
type CompactCapabilityEntry = CodexCompactCapability & {
  key: string;
  checkedAtMs?: number;
};
```

active Provider 为 Codex、thread 已有 sessionId 且工作目录有效时请求能力；请求开始设 checking，失败设 error。Provider、channel、session 或 working directory 变化时换 key，不复用错误 runtime 的旧结果。Claude 不调用该 API。

- [x] **Step 4: 实现统一 `requestThreadCompaction`**

hook 对外只暴露一个入口：

```ts
async function requestThreadCompaction(
  thread: ThreadSummary,
  trigger: 'slash' | 'context' | 'retry',
): Promise<boolean>;
```

行为固定：能力不是 supported 时提示准确原因且不创建历史；无 sessionId 时提示“完成至少一轮 Codex 对话后才能压缩上下文”；已有未终结 compact 时定位原卡并提示；存在活动 turn 时创建 status=waiting 的系统 turn 并返回；空闲时创建 status=preparing 后请求专用 API。NDJSON 的 `context-compaction` 原位更新卡片；`done` 只在卡片已 completed 时释放队列；`error` 把卡片设 failed 并保持屏障。

- [x] **Step 5: 接入 ordinary turn 内的 automatic compact event**

`handleAgentEvent` 在普通 `applyAgentRunEventToTurn` 之前处理：

```ts
if (event.type === 'context-compaction') {
  applyContextCompactionEvent(context.threadId, event, context.workingDirectory);
  schedulePersistThreadHistory(context.threadId, { urgent: event.status !== 'running' });
  return;
}
```

operationId 缺失且没有 manual operation 可关联时 source 必须为 automatic，并用 provider item/turn ID 生成稳定卡片 ID；automatic 卡片不建立人工 barrier，也不出现 skip 动作。

- [x] **Step 6: 运行能力、事件和类型测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compact_capability -- --nocapture`

Expected: PASS。

Run: `node --import tsx --test src/lib/codex-compact.test.ts src/lib/queued-prompts.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

- [x] **Step 7: 提交 coordinator**

```powershell
git add -- src-tauri/src/agent_run.rs src/hooks/useAgentRun.ts src/types.ts src/lib/codex-compact.test.ts
git commit -m "feat: coordinate Codex compact operations"
```

### Task 7: `/compact`、上下文按钮与紧凑系统卡片

**Files:**
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/backend.rs`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/ComposerContextIndicator.tsx`
- Modify: `src/components/ConversationPane.tsx`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/styles.css`
- Create: `src/lib/codex-compact-ui.test.ts`
- Modify: `src/lib/claude-slash-system-commands.test.ts`
- Modify: `src/lib/slash-command-filter.test.ts`

- [ ] **Step 1: 写双入口和 system turn UI 失败测试**

```ts
test('Codex compact slash command uses the native coordinator while Claude keeps its submission', () => {
  assert.match(appSource, /activeProviderId === OPENAI_CODEX_PROVIDER_ID[\s\S]*requestThreadCompaction/);
  assert.match(appSource, /buildCompactSlashCommandSubmission/);
});

test('builtin compact is available to Claude and Codex only', () => {
  const compact = Object.assign({}, commands.find((command) => command.id === 'builtin:/compact')!, {
    agentScope: ['claude', 'codex'] as SlashCommand['agentScope'],
  });
  assert.deepEqual(
    filterSlashCommandsForAgent([compact], 'codex').map((command) => command.slash),
    ['/compact'],
  );
});

test('context indicator exposes one capability-aware compact action', () => {
  assert.match(indicatorSource, /onCompactContext/);
  assert.match(indicatorSource, /compactAvailability\.reason/);
  assert.match(indicatorSource, /压缩上下文/);
});

test('system turns do not render fake user or assistant labels', () => {
  assert.match(turnSource, /turn\.kind === 'system'/);
  assert.match(turnSource, /system-turn-content/);
});
```

- [ ] **Step 2: 运行 UI contract tests 并确认失败**

Run: `node --import tsx --test src/lib/codex-compact-ui.test.ts src/lib/claude-slash-system-commands.test.ts`

Expected: FAIL，尚未接线。

- [ ] **Step 3: 改接 `/compact` 且保留 Claude 行为**

先把 backend builtin command 的 description 改为 Provider 中立文案，并让该命令单独返回
`agentScope: ["claude", "codex"]`；`/context`、`/cost` 与其他 Claude commands 保持原 scope。不要把
`slash_command` helper 的默认 scope 整体放宽。

在 `backend.rs` 现有 `slash_command_catalog_keeps_required_local_commands_unique` 旁新增：

```rust
#[test]
fn slash_command_catalog_exposes_compact_to_claude_and_codex_only() {
    let commands = list_slash_commands_value(None);
    let compact = commands.iter()
        .find(|command| command.get("slash").and_then(Value::as_str) == Some("/compact"))
        .expect("compact command");
    assert_eq!(compact["agentScope"], json!(["claude", "codex"]));
    let context = commands.iter()
        .find(|command| command.get("slash").and_then(Value::as_str) == Some("/context"))
        .expect("context command");
    assert_eq!(context["agentScope"], json!(["claude"]));
}
```

`App.tsx` 的分支必须明确区分 Provider：

```ts
if (command.localActionId === 'compact-thread') {
  if (activeProviderId === OPENAI_CODEX_PROVIDER_ID) {
    await requestThreadCompaction(thread, 'slash');
  } else {
    await submitPromptToThread(thread, buildCompactSlashCommandSubmission(submittedText));
  }
  return;
}
```

旧 Codex CLI、checking/error、无 session、已有 compact 时该命令不会进入普通 prompt 提交。

- [ ] **Step 4: 在上下文弹层增加统一按钮**

`ComposerContextIndicatorProps` 增加 `compactAvailability` 和 `onCompactContext`。按钮使用 lucide `Minimize2`，disabled/title/aria-label 都来自同一个 availability：

```tsx
<button
  type="button"
  className="composer-context-compact-action"
  disabled={!compactAvailability.available}
  title={compactAvailability.available ? '压缩上下文' : compactAvailability.reason}
  onClick={() => void onCompactContext?.()}
>
  <Minimize2 size={14} />
  <span>{compactAvailability.busy ? '正在压缩' : '压缩上下文'}</span>
</button>
```

该按钮仅在 active Provider 为 Codex 时展示；Claude 保持当前弹层，不新增第二套 compact handler。

- [ ] **Step 5: 渲染 system turn 与 compact actions**

`ConversationTurnViewComponent` 在普通 message 布局前增加 system 分支，内部仍复用 `SystemCommandCard`。`SystemCommandCard` 增加 `onRetryCompact`、`onSkipCompact`；manual failed/interrupted 显示 lucide `RotateCcw` 图标按钮（带 tooltip）和文字命令“跳过并继续”，automatic 不显示 skip。状态文案固定映射：等待、准备中、压缩中、已完成、失败、已中断、失败后已跳过。

- [ ] **Step 6: 增加主题一致的样式**

新增 class 只使用现有主题变量，例如 `--surface-*`、`--border-*`、`--text-*`、`--accent-*`；卡片圆角不超过现有系统卡片；动作按钮尺寸稳定，不因文字或 loading 改变布局。同步检查 light/dark、comfortable/compact、desktop/web，禁止硬编码蓝色 focus ring。

- [ ] **Step 7: 运行 UI tests、typecheck 和 build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slash_command_catalog_exposes_compact_to_claude_and_codex_only`

Expected: PASS。

Run: `node --import tsx --test src/lib/codex-compact-ui.test.ts src/lib/claude-slash-system-commands.test.ts src/lib/slash-command-filter.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

Run: `npm run build`

Expected: PASS，Vite 输出 production assets。

- [ ] **Step 8: 提交双入口与卡片**

```powershell
git add -- src/App.tsx src-tauri/src/backend.rs src/components/Composer.tsx src/components/ComposerContextIndicator.tsx src/components/ConversationPane.tsx src/components/ConversationTurn.tsx src/styles.css src/lib/codex-compact-ui.test.ts src/lib/claude-slash-system-commands.test.ts src/lib/slash-command-filter.test.ts
git commit -m "feat: add Codex compact controls and card"
```

### Task 8: 历史 round-trip 与重启只读核对

**Files:**
- Modify: `src-tauri/src/codex_app_server.rs`
- Modify: `src-tauri/src/agent_run.rs`
- Modify: `src-tauri/src/backend.rs`
- Modify: `src/hooks/useAgentRun.ts`
- Modify: `src/lib/conversation.test.ts`
- Test: `src-tauri/src/backend.rs` 内测试模块

- [ ] **Step 1: 写 native history read 失败测试**

Codex mock 测试固定请求：

```rust
let request = read_wire(&mut lines).await;
assert_eq!(request["method"], "thread/read");
assert_eq!(request["params"], json!({
    "threadId": "provider-thread-1",
    "includeTurns": true
}));
```

响应包含多个 turns/items；所有本地已保存的 provider ID 都匹配、turn status=`completed` 且 item
type=`contextCompaction` 时返回 Confirmed。只有 providerTurnId 时按 turn 与 item type 核对；只有
providerItemId 时按 item 与所属 turn 核对；两个 ID 都没有时返回 Unconfirmed，禁止按时间选择最近一次压缩。
找不到返回 NotFound；同 item 位于 failed/interrupted/inProgress turn 时返回 Unconfirmed，不把 request accepted
当完成。

- [ ] **Step 2: 实现 `read_compaction_history`**

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodexCompactionHistoryState {
    Confirmed(CodexCompactionOutcome),
    Unconfirmed,
    NotFound,
}
```

`thread/read` 使用 `includeTurns=true`，只提取 thread/turn/item ID 和 status；不把 user/assistant 内容、compact 正文或原始 JSON 写入日志和 API。

- [ ] **Step 3: 写 SQLite JSON round-trip 失败测试**

```rust
#[test]
fn thread_history_round_trip_preserves_compact_system_turn_without_schema_change() {
    let mut connection = Connection::open_in_memory().expect("open database");
    initialize_workspace_database(&connection).expect("initialize database");
    connection.execute(
        "INSERT INTO projects (id, path, name, custom_name, created_at, updated_at) VALUES ('project', 'D:/workspace', 'workspace', 0, '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z')",
        [],
    ).expect("insert project");
    let thread_id = create_thread_row(
        &mut connection,
        "project",
        Some("Codex compact"),
        OPENAI_CODEX_PROVIDER_ID,
        Some("auto"),
        Some("gpt-codex"),
        None,
        None,
        true,
    ).expect("create thread");
    let turns = vec![json!({
        "id": "compact-turn-1",
        "kind": "system",
        "userText": "",
        "assistantText": "",
        "status": "running",
        "tools": [],
        "items": [{
            "id": "compact-item-local-1",
            "type": "system-command",
            "command": "/compact",
            "title": "压缩上下文",
            "cardType": "compact",
            "state": "running",
            "compact": {
                "operationId": "compact-1",
                "source": "manual",
                "status": "running",
                "attempt": 1,
                "providerThreadId": "provider-thread-1",
                "requestedAtMs": 1754092800000_i64
            }
        }]
    })];
    write_thread_history(&mut connection, &thread_id, &turns).expect("write history");
    let restored = read_stored_thread_history(&connection, &thread_id).expect("read history");
    assert_eq!(restored[0]["kind"], "system");
    assert_eq!(restored[0]["userText"], "");
    assert_eq!(restored[0]["items"][0]["compact"]["operationId"], "compact-1");
    assert_eq!(restored[0]["items"][0]["compact"]["status"], "running");
}
```

- [ ] **Step 4: 恢复 system kind 而不迁移数据库**

`write_thread_history` 继续把 system-command item 序列化到现有 content JSON；`read_stored_thread_history` 观察到带 `compact` metadata 的 system-command item 时设置 `turn["kind"]="system"`。不新增 column/table，不把 kind 塞进 userText，不改普通 system command 的旧展示语义。

- [ ] **Step 5: 新增只读 reconcile route**

路由固定为：

```rust
.route(
    "/api/agents/runtime/{thread_id}/compact/reconcile",
    post(reconcile_agent_compact),
)
```

请求携带 operationId、sessionId、workspace/channel config 和可用 providerTurnId/providerItemId。handler 先确认该 CodeM thread 没有 active runtime operation，再启动 Codex App Server、initialize、`thread/read(includeTurns=true)`；response thread.id 必须等于 sessionId。响应只返回 `{state:'confirmed'|'unconfirmed'|'not_found', providerTurnId?, providerItemId?}`。整个路径不调用 `thread/compact/start`。

- [ ] **Step 6: 前端仅在历史加载后核对未终结卡片**

`useAgentRun` 接收 active thread detail/historyLoaded。发现 waiting/preparing/running 时只调用 reconcile：confirmed 原位 completed；unconfirmed/not_found/error 原位 interrupted 并提供 retry；同一 operation ID 每次应用进程只核对一次。任何结果都不自动调用 `requestThreadCompaction`。

- [ ] **Step 7: 运行恢复与持久化测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compaction_history -- --nocapture`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml thread_history_round_trip_preserves_compact_system_turn_without_schema_change -- --nocapture`

Expected: PASS。

Run: `node --import tsx --test src/lib/codex-compact.test.ts src/lib/conversation.test.ts`

Expected: PASS，未完成 operation 只会被标记 interrupted，不会生成第二张卡或自动重放。

- [ ] **Step 8: 提交恢复链路**

```powershell
git add -- src-tauri/src/codex_app_server.rs src-tauri/src/agent_run.rs src-tauri/src/backend.rs src/hooks/useAgentRun.ts src/lib/conversation.test.ts
git commit -m "feat: reconcile compact history after restart"
```

### Task 9: 回归、性能、桌面验收与 Trellis 闭环

**Files:**
- Modify: `.trellis/tasks/codex-native-compact.md`
- Modify: `.trellis/tasks/codex-native-compact-implementation-plan.md`（只勾选已完成步骤与记录实际偏差）
- Modify: `.trellis/workspace/sessions/session-20260801-171404-tnfn-codex-native-compact.md`（由 Trellis CLI 写入）

- [ ] **Step 1: 运行 frontend targeted tests**

Run: `node --import tsx --test src/lib/codex-compact.test.ts src/lib/queued-prompts.test.ts src/lib/codex-compact-ui.test.ts src/lib/claude-slash-system-commands.test.ts src/lib/slash-command-filter.test.ts src/lib/conversation.test.ts`

Expected: PASS，无失败、跳过或未处理 rejection。

- [ ] **Step 2: 运行全部 TypeScript tests**

Run:

```powershell
$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' })
node --import tsx --test $testFiles
```

Expected: PASS；记录实际文件数和 test 数到 Trellis verify。

- [ ] **Step 3: 运行 backend targeted 与全量 tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml agent_run`

Expected: PASS。

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS。

- [ ] **Step 4: 运行格式、类型、构建和 diff 门禁**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

Expected: PASS，无格式差异。

Run: `npm run typecheck`

Expected: PASS。

Run: `npm run build`

Expected: PASS。

Run: `git diff --check`

Expected: 无输出，exit code 0。

- [ ] **Step 5: 重启桌面开发服务**

停止本任务启动的旧 CodeM desktop dev 进程，再运行：

Run: `npm run desktop:dev`

Expected: Tauri 桌面窗口启动；backend health 可用：

Run: `Invoke-RestMethod http://127.0.0.1:3001/api/health`

Expected: 返回健康状态；若后端自动选择其他端口，以 desktop-dev 输出端口为准。

- [ ] **Step 6: 执行桌面手工验收**

按固定顺序验证并截图/记录结果：

1. Codex 完成至少一轮后，从 `/compact` 触发，网络/日志中出现 `thread/compact/start`，不出现普通 `/compact` prompt。
2. 从上下文用量弹层触发同一行为，重复点击只定位原卡并提示，不生成第二张卡。
3. 回答运行中触发 compact，再发送普通消息；确认顺序为当前 turn、compact、queued prompt。
4. 成功前后 sessionId 不变、可见历史不丢、卡片在原位从 waiting/preparing/running 变 completed。
5. mock unsupported/error/timeout/process-exit；确认 unsupported 提示升级，失败后队列暂停。
6. failed 卡点“重试”复用原卡且 attempt+1；“跳过并继续”保留 skipped 事实并只发送一次队首消息。
7. automatic `contextCompaction` 只由原生 event 创建，卡片无 skip。
8. 在 running compact 时关闭并重启；确认只读 reconcile，能确认则 completed，否则 interrupted，绝不自动再次 compact。
9. 切换两个 Codex thread，确认 compact、队列、卡片和操作不串线。
10. 检查 debug/raw/history，不包含 compact 正文、原始协议包、环境变量或凭证。

- [ ] **Step 7: 检查长历史更新性能**

在包含至少 200 个 turns 的本地测试历史中触发同一 compact 卡片的 running/completed 更新；React DevTools 或浏览器 Performance 中确认只替换目标 turn，未出现全部 ConversationTurn 卸载重建，滚动位置和“回到底部”按钮保持正确。

- [ ] **Step 8: 写入 Trellis 验证记录**

每个实际执行的命令分别记录，不合并成未经验证的总括：

```powershell
npm run trellis -- verify "node --import tsx --test compact/queue/UI/conversation targeted tests" --result "PASS"
npm run trellis -- verify "cargo test --manifest-path src-tauri/Cargo.toml" --result "PASS"
npm run trellis -- verify "cargo fmt --check + npm run typecheck + npm run build + git diff --check" --result "全部通过"
npm run trellis -- record "桌面手工验收完成：双入口、严格顺序、失败恢复、重启核对、跨 thread 隔离和日志脱敏均符合任务验收标准"
```

- [ ] **Step 9: 对照主任务逐项勾选 Acceptance Criteria**

逐项检查 `.trellis/tasks/codex-native-compact.md` 的 13 条验收标准；没有当前证据的条目保持未勾选并继续修复或验证，不使用“代码已写”等同“已验收”。在 Implementation Record 记录实现 commit、协议偏差和最终验证数字。

- [ ] **Step 10: 完成 Trellis session**

Run:

```powershell
npm run trellis -- complete --summary "已接入 Codex 原生 thread/compact/start：具备能力探测、actor 串行、双入口、结构化卡片、失败重试/跳过、automatic event、历史 round-trip 与重启只读核对；Claude 和普通 Agent 队列回归通过。"
```

Expected: 当前 session 状态被清除，task Completion Summary 和 session record 均写入完成摘要。

- [ ] **Step 11: 提交验收记录**

```powershell
git add -- .trellis/tasks/codex-native-compact.md .trellis/tasks/codex-native-compact-implementation-plan.md .trellis/workspace/sessions/session-20260801-171404-tnfn-codex-native-compact.md
git commit -m "docs: complete Codex compact acceptance"
```

## 需求覆盖自审表

| 已确认需求 | 覆盖任务 |
|---|---|
| 无副作用 capability probe，旧 CLI 禁用并提示升级 | Task 1、Task 6、Task 7 |
| 原生 `thread/compact/start`，不发送 Codex `/compact` 文本 | Task 1、Task 3、Task 7 |
| `turn -> compact -> queued prompt` 串行顺序 | Task 3、Task 5、Task 9 |
| 同 thread 防重、跨 thread 隔离 | Task 3、Task 4、Task 5、Task 9 |
| accepted 不等于 completed | Task 1、Task 6、Task 8 |
| 单卡片原位更新，区分 manual/automatic | Task 2、Task 4、Task 6、Task 7 |
| 失败暂停，retry/skip 明确恢复 | Task 4、Task 5、Task 7 |
| 重启不重放，只读历史核对 | Task 4、Task 8、Task 9 |
| 复用 history JSON，不新增 SQLite 表 | Task 4、Task 8 |
| 双入口共用 coordinator | Task 6、Task 7 |
| 日志/历史脱敏，不保存 compact 正文 | Task 1、Task 3、Task 6、Task 8、Task 9 |
| Claude `/compact`、steer、普通运行与队列无回归 | Task 5、Task 7、Task 9 |
| 长历史只更新目标 turn | Task 4、Task 9 |

## 实施约束

- 所有生产改动按任务顺序 TDD；先看到预期失败，再写最小实现，再跑通过。
- 每完成一个 task 更新本计划对应 checkbox，并用 `npm run trellis -- record` 写入关键决定。
- 不提交 `.tmp-dev/`；每次 `git add` 都使用明确路径。
- 不修改 Claude、Grok、OpenCode、Pi 的 compact 协议，不新增自定义摘要或 token 阈值推测。
- 不以 RPC accepted、deprecated notification、时间接近或自然语言文案冒充完成事实。
- 不在 debug/raw/history 中保存原始 App Server JSON、环境变量、凭证或 compact 正文。
