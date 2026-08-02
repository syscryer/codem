# Claude 在新聊天中继续 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Code 聊天复用现有“在新聊天中继续”入口，通过原生 `--resume <sessionId> --fork-session` 创建独立会话，并保留现有 Codex Fork 的幂等、事务和恢复能力。

**Architecture:** 前端把现有 Codex 专用 Fork helper 和 capability 类型收口为 Provider 感知的共享契约。后端保留共享路由、操作表和本地事务，在 Provider 边界分别调用 Codex App Server 或新的 Claude CLI 一次性 Fork 桥；Claude 新 session ID 确认后才创建本地 thread，历史从新 transcript 读取，暂不可读时使用现有 `history_pending` 恢复。

**Tech Stack:** React 19、TypeScript、Node test runner、Rust 2021、Axum、Tokio process/IO、rusqlite、Claude Code stream-json CLI、Trellis。

---

## File Map

- Create `src/lib/thread-fork.ts`: Provider 感知的前端 Fork capability key、可用性文案和响应归一化。
- Create `src/lib/thread-fork.test.ts`: Claude/Codex/其他 Provider、状态门禁和响应隔离测试。
- Create `src/lib/thread-fork-ui.test.ts`: 两个现有菜单入口和无本地历史复制回归。
- Delete `src/lib/codex-thread-fork.ts`、`src/lib/codex-thread-fork.test.ts`、`src/lib/codex-thread-fork-ui.test.ts`: 由共享文件替代。
- Modify `src/types.ts`: `CodexThreadForkCapability` 改为 `ThreadForkCapability`，响应 wire shape 保持兼容。
- Modify `src/hooks/useWorkspaceState.ts`: 使用共享 helper/type；请求路径、operation ID 和原子接入不变。
- Create `src-tauri/src/claude_session_fork.rs`: capability 解析、Fork init session ID 提取和一次性进程生命周期。
- Modify `src-tauri/src/lib.rs`: 注册 `claude_session_fork` 模块。
- Modify `src-tauri/src/backend.rs`: 可信源校验、Provider 分流、运行门禁、Claude 渠道配置、transcript 和恢复。
- Modify `.trellis/tasks/claude-continue-in-new-chat.md` 与当前 session record: 记录实现和验收证据。

## Task 1: Frontend Provider-Neutral Fork Contract

**Files:**
- Create: `src/lib/thread-fork.ts`
- Create: `src/lib/thread-fork.test.ts`
- Create: `src/lib/thread-fork-ui.test.ts`
- Modify: `src/types.ts`
- Modify: `src/hooks/useWorkspaceState.ts`
- Delete: `src/lib/codex-thread-fork.ts`
- Delete: `src/lib/codex-thread-fork.test.ts`
- Delete: `src/lib/codex-thread-fork-ui.test.ts`

- [ ] **Step 1: Write failing Provider availability tests**

Move the current tests to `src/lib/thread-fork.test.ts`, import from `./thread-fork`, and add:

```ts
test('fork availability supports native Claude and Codex sessions only', () => {
  const base = {
    capability: { state: 'supported' as const },
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'openai-codex' }) }),
    { enabled: true },
  );
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'claude-code' }) }),
    { enabled: true },
  );
  assert.deepEqual(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'grok-build' }) }),
    { enabled: false, reason: '当前 Agent 暂不支持在新聊天中继续' },
  );
});

test('unsupported capability names the active Provider', () => {
  const base = {
    capability: { state: 'unsupported' as const },
    busy: false,
    pendingHumanRequest: false,
    forking: false,
  };
  assert.match(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'claude-code' }) }).reason ?? '',
    /升级 Claude Code/,
  );
  assert.match(
    getThreadForkAvailability({ ...base, thread: thread({ provider: 'openai-codex' }) }).reason ?? '',
    /升级 Codex CLI/,
  );
});
```

Keep the existing missing-session, busy, pending-human, checking, error, forking, loaded-history, pending-history, response-ID and capability-key tests.

- [ ] **Step 2: Run the frontend tests and verify RED**

Run:

```powershell
npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts
```

Expected: FAIL because `src/lib/thread-fork.ts` does not exist and Claude is not accepted.

- [ ] **Step 3: Add the shared type and helper**

In `src/types.ts` define the unchanged wire shape under a shared name:

```ts
export type ThreadForkCapability = {
  state: 'checking' | 'supported' | 'unsupported' | 'error';
  message?: string;
};
```

Create `src/lib/thread-fork.ts`:

```ts
import type {
  ThreadDetail,
  ThreadForkAvailability,
  ThreadForkCapability,
  ThreadForkResponse,
  ThreadSummary,
} from '../types';

const FORK_PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'openai-codex': 'Codex CLI',
};

export function threadForkCapabilityKey(thread: ThreadSummary): string {
  return JSON.stringify([
    thread.provider,
    thread.sessionId,
    thread.workingDirectory,
    thread.agentChannelId ?? '',
    thread.agentChannelFingerprint ?? '',
    thread.model ?? '',
    thread.reasoningEffort ?? '',
    thread.permissionMode ?? '',
  ]);
}

export function getThreadForkAvailability(input: {
  thread: ThreadSummary;
  capability?: ThreadForkCapability;
  busy: boolean;
  pendingHumanRequest: boolean;
  forking: boolean;
}): ThreadForkAvailability {
  const providerLabel = FORK_PROVIDER_LABELS[input.thread.provider];
  if (!providerLabel) return { enabled: false, reason: '当前 Agent 暂不支持在新聊天中继续' };
  if (!input.thread.sessionId.trim()) {
    return { enabled: false, reason: `当前聊天尚未绑定 ${providerLabel} 会话` };
  }
  if (input.busy) return { enabled: false, reason: '当前聊天正在运行' };
  if (input.pendingHumanRequest) return { enabled: false, reason: '当前聊天正在等待确认或输入' };
  if (input.forking) return { enabled: false, reason: '正在创建新聊天' };
  if (!input.capability || input.capability.state === 'checking') {
    return { enabled: false, reason: `正在检查 ${providerLabel} Fork 能力` };
  }
  if (input.capability.state === 'unsupported') {
    const suffix = input.capability.message ? `。${input.capability.message}` : '';
    return {
      enabled: false,
      reason: `当前 ${providerLabel} 不支持在新聊天中继续，请升级 ${providerLabel}${suffix}`,
    };
  }
  if (input.capability.state === 'error') {
    return { enabled: false, reason: input.capability.message || `无法检查 ${providerLabel} Fork 能力` };
  }
  return { enabled: true };
}

export function threadDetailFromForkResponse(response: ThreadForkResponse): ThreadDetail {
  if (response.threadId !== response.thread.id || response.history.threadId !== response.threadId) {
    throw new Error('Fork 响应中的聊天 ID 不一致');
  }
  return {
    ...response.thread,
    turns: response.historyState === 'loaded' ? response.history.turns : [],
    debugEvents: [],
    rawEvents: [],
    claudeContext: response.historyState === 'loaded' ? response.history.claudeContext : undefined,
    historyLoaded: response.historyState === 'loaded',
    historyLoading: false,
  };
}
```

Update `useWorkspaceState.ts` imports and state annotations to `ThreadForkCapability`. Move the UI contract test unchanged except for its filename.

- [ ] **Step 4: Run frontend tests and typecheck for GREEN**

Run:

```powershell
npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts
npm run typecheck
```

Expected: all thread-fork tests pass and typecheck exits 0.

- [ ] **Step 5: Record and commit Task 1**

Run:

```powershell
npm run trellis -- record "完成共享 Thread Fork 前端契约：Claude/Codex 使用同一入口和状态门禁，其他 Provider 明确禁用。"
git add -- src/types.ts src/hooks/useWorkspaceState.ts src/lib/thread-fork.ts src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts src/lib/codex-thread-fork.ts src/lib/codex-thread-fork.test.ts src/lib/codex-thread-fork-ui.test.ts .trellis/tasks/claude-continue-in-new-chat.md .trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md
git commit -m "refactor: share thread fork frontend contract"
```

## Task 2: Claude CLI Fork Protocol Bridge

**Files:**
- Create: `src-tauri/src/claude_session_fork.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the module and write failing pure protocol tests**

Add `pub mod claude_session_fork;` to `src-tauri/src/lib.rs`, then start the new module with tests only:

```rust
#[cfg(test)]
mod tests {
    use super::{extract_fork_session_id, help_supports_fork_session};

    #[test]
    fn claude_session_fork_help_requires_exact_flag() {
        assert!(help_supports_fork_session(
            "--fork-session  When resuming, create a new session ID"
        ));
        assert!(!help_supports_fork_session("--resume <value>"));
        assert!(!help_supports_fork_session("fork session documentation"));
    }

    #[test]
    fn claude_session_fork_accepts_only_a_new_init_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"child-session"}"#;
        assert_eq!(
            extract_fork_session_id(line, "source-session").unwrap(),
            Some("child-session".to_string())
        );
        let same = r#"{"type":"system","subtype":"init","session_id":"source-session"}"#;
        assert!(extract_fork_session_id(same, "source-session").is_err());
        let assistant = r#"{"type":"assistant","session_id":"child-session"}"#;
        assert_eq!(extract_fork_session_id(assistant, "source-session").unwrap(), None);
    }
}
```

- [ ] **Step 2: Run the Rust test and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork
```

Expected: FAIL with unresolved imports for `extract_fork_session_id` and `help_supports_fork_session`.

- [ ] **Step 3: Implement capability and event parsing**

Implement:

```rust
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClaudeSessionForkError {
    Unsupported(String),
    Rejected(String),
    Uncertain(String),
}

pub(crate) fn help_supports_fork_session(output: &str) -> bool {
    output.split_whitespace().any(|token| {
        token.trim_matches(|ch: char| ch == ',' || ch == ';') == "--fork-session"
    })
}

pub(crate) fn extract_fork_session_id(
    line: &str,
    source_session_id: &str,
) -> Result<Option<String>, ClaudeSessionForkError> {
    let payload: Value = match serde_json::from_str(line) {
        Ok(payload) => payload,
        Err(_) => return Ok(None),
    };
    if payload.get("type").and_then(Value::as_str) != Some("system")
        || payload.get("subtype").and_then(Value::as_str) != Some("init")
    {
        return Ok(None);
    }
    let session_id = payload
        .get("session_id")
        .or_else(|| payload.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ClaudeSessionForkError::Rejected(
            "Claude Fork 初始化事件缺少有效 session ID".to_string(),
        ))?;
    if session_id == source_session_id {
        return Err(ClaudeSessionForkError::Rejected(
            "Claude Fork 返回了源 session ID".to_string(),
        ));
    }
    Ok(Some(session_id.to_string()))
}
```

- [ ] **Step 4: Add failing async reader tests**

```rust
#[tokio::test]
async fn claude_session_fork_reads_init_and_ignores_other_events() {
    let input = concat!(
        "not-json\n",
        "{\"type\":\"system\",\"subtype\":\"status\"}\n",
        "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"child\"}\n"
    );
    let reader = tokio::io::BufReader::new(input.as_bytes());
    let session_id = read_fork_session_id(reader, "source").await.unwrap();
    assert_eq!(session_id, "child");
}

#[tokio::test]
async fn claude_session_fork_eof_without_init_is_uncertain() {
    let reader = tokio::io::BufReader::new("{\"type\":\"system\"}\n".as_bytes());
    assert!(matches!(
        read_fork_session_id(reader, "source").await,
        Err(ClaudeSessionForkError::Uncertain(_))
    ));
}
```

Run the same filtered Rust command and confirm it fails because `read_fork_session_id` is absent.

- [ ] **Step 5: Implement the bounded one-shot process**

Add these public(crate) contracts:

```rust
pub(crate) struct ClaudeSessionForkLaunch {
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: String,
    pub environment: std::collections::HashMap<String, String>,
    pub source_session_id: String,
}

pub(crate) struct ClaudeSessionForkOutcome {
    pub session_id: String,
}
```

Implement `read_fork_session_id` with `AsyncBufReadExt::lines`. Implement `probe_fork_session` and `create_session_fork` with `tokio::process::Command`, piped stdin/stdout/stderr, the existing Windows no-console flag, and a 10-second timeout. Keep stdin open until init, then drop it, wait briefly for a clean exit, and kill only on timeout. EOF, timeout, or process failure after spawn but before a trustworthy init returns `Uncertain`; public stderr is whitespace-normalized and capped at 512 characters.

- [ ] **Step 6: Run module tests for GREEN**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork
```

Expected: all module tests pass.

- [ ] **Step 7: Record and commit Task 2**

```powershell
npm run trellis -- record "完成 Claude Fork CLI 协议桥：精确 capability、无 prompt init session ID、超时/EOF 不确定结果和敏感错误边界。"
git add -- src-tauri/src/lib.rs src-tauri/src/claude_session_fork.rs .trellis/tasks/claude-continue-in-new-chat.md .trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md
git commit -m "feat: add Claude session fork bridge"
```

## Task 3: Trusted Provider Capability And Runtime Gate

**Files:**
- Modify: `src-tauri/src/backend.rs`

- [ ] **Step 1: Write failing trusted Provider tests**

Extend the existing in-memory source helper with a Provider parameter, then add:

```rust
#[test]
fn thread_fork_source_accepts_only_native_fork_providers() {
    let mut connection = Connection::open_in_memory().expect("open database");
    initialize_workspace_database(&connection).expect("initialize database");
    let claude = fork_operation_source_with_provider(
        &connection,
        "claude-source",
        CLAUDE_CODE_PROVIDER_ID,
        "claude-session",
    );
    assert_eq!(claude.provider, CLAUDE_CODE_PROVIDER_ID);
    let codex = fork_operation_source_with_provider(
        &connection,
        "codex-source",
        OPENAI_CODEX_PROVIDER_ID,
        "codex-thread",
    );
    assert_eq!(codex.provider, OPENAI_CODEX_PROVIDER_ID);
}

#[test]
fn thread_fork_prepare_rejects_non_native_provider() {
    let mut connection = Connection::open_in_memory().expect("open database");
    initialize_workspace_database(&connection).expect("initialize database");
    let source = fork_operation_source_with_provider(
        &connection,
        "grok-source",
        GROK_BUILD_PROVIDER_ID,
        "grok-session",
    );
    let error = prepare_thread_fork_operation(
        &mut connection,
        &source,
        "operation-grok",
        1_754_092_800_000,
    )
    .expect_err("reject Provider without native Fork");
    assert_eq!(error.status, StatusCode::BAD_REQUEST);
}
```

Add an async API test using `ThreadForkTestDriver` that records `source.provider` and proves request JSON still rejects forged `provider`, `sessionId`, and `workingDirectory` fields.

- [ ] **Step 2: Run backend Fork tests and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml thread_fork
```

Expected: FAIL because source validation and operation preparation still allow only Codex.

- [ ] **Step 3: Generalize trusted source validation and capability dispatch**

Add:

```rust
fn provider_supports_native_thread_fork(provider: &str) -> bool {
    matches!(provider, CLAUDE_CODE_PROVIDER_ID | OPENAI_CODEX_PROVIDER_ID)
}

fn thread_fork_provider_label(provider: &str) -> &'static str {
    match provider {
        CLAUDE_CODE_PROVIDER_ID => "Claude Code",
        OPENAI_CODEX_PROVIDER_ID => "OpenAI Codex",
        _ => "当前 Agent",
    }
}
```

Use the predicate in `read_fork_source_thread` and `prepare_thread_fork_operation`. Keep project-directory validation, non-empty Provider ID, bounded operation ID, pending-human gate, and request `deny_unknown_fields`. Rename the two route handlers to Provider-neutral function names without changing URLs.

Dispatch capability from the database source:

```rust
match source.provider.as_str() {
    OPENAI_CODEX_PROVIDER_ID => probe_thread_fork_capability(
        &state,
        source.control_config(),
        payload.refresh,
    ).await,
    CLAUDE_CODE_PROVIDER_ID => probe_claude_thread_fork_capability(
        &state,
        &source,
        payload.refresh,
    ).await,
    _ => unreachable!("source validation rejects unsupported Providers"),
}
```

`probe_claude_thread_fork_capability` resolves the backend-owned Claude command, calls `probe_fork_session`, and returns the current `{ state, message }` shape. Cache by command path plus reported version for 60 seconds; `refresh=true` bypasses the cache.

- [ ] **Step 4: Add failing Claude runtime-gate tests**

Add tests for `ensure_claude_thread_fork_idle` covering:

```rust
assert!(ensure_claude_thread_fork_idle(&state_with_active_runtime, "thread-1").is_err());
assert!(ensure_claude_thread_fork_idle(&state_with_active_run, "thread-1").is_err());
assert!(ensure_claude_thread_fork_idle(&state_with_context_request, "thread-1").is_err());
assert!(ensure_claude_thread_fork_idle(&idle_state, "thread-1").is_ok());
```

Run the filtered test and confirm RED because the helper is absent.

- [ ] **Step 5: Implement the runtime gate before operation persistence**

Read `state.runtimes`, `state.runs`, and `state.context_requests` under their existing locks. Treat non-finished runs, `current_run_id`, and pending context requests as conflicts. Call this helper before `prepare_thread_fork_operation`, so a rejected request creates no operation row. Do not close or mutate the source runtime.

```rust
fn ensure_claude_thread_fork_idle(state: &AppState, thread_id: &str) -> ApiResult<()> {
    let runtime_busy = state
        .runtimes
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 Claude 会话失败: {error}")))?
        .get(thread_id)
        .is_some_and(|runtime| runtime.current_run_id.is_some());
    let run_busy = state
        .runs
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 Claude 运行失败: {error}")))?
        .values()
        .any(|run| run.thread_id == thread_id && !run.finished);
    let context_pending = state
        .context_requests
        .lock()
        .map_err(|error| ApiError::internal(format!("读取 Claude 上下文请求失败: {error}")))?
        .contains_key(thread_id);
    if runtime_busy || run_busy || context_pending {
        return Err(ApiError::conflict("当前聊天正在运行或等待处理，暂时不能在新聊天中继续"));
    }
    Ok(())
}
```

- [ ] **Step 6: Run capability and Codex regression tests for GREEN**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml thread_fork
cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork
```

Expected: Claude source/capability/gate tests and existing Codex Fork tests pass.

- [ ] **Step 7: Record and commit Task 3**

```powershell
npm run trellis -- record "完成可信 Fork 能力分流：后端从源 thread 派生 Provider/会话/目录，Claude 运行态与人工输入双重门禁，Codex 路径保持不变。"
git add -- src-tauri/src/backend.rs .trellis/tasks/claude-continue-in-new-chat.md .trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md
git commit -m "feat: route thread fork capabilities by provider"
```

## Task 4: Claude Fork Creation, Transaction And History Recovery

**Files:**
- Modify: `src-tauri/src/backend.rs`
- Modify: `src-tauri/src/claude_session_fork.rs`

- [ ] **Step 1: Write failing argument and identity tests**

Add alongside the Claude run-args tests:

```rust
#[test]
fn claude_fork_args_resume_source_and_request_a_new_session() {
    let source = ForkSourceThread {
        id: "local-source".to_string(),
        project_id: "project-1".to_string(),
        provider: CLAUDE_CODE_PROVIDER_ID.to_string(),
        title: "Source".to_string(),
        custom_title: true,
        provider_thread_id: "source-session".to_string(),
        working_directory: "D:/workspace".to_string(),
        model: Some("sonnet".to_string()),
        reasoning_effort: Some("high".to_string()),
        permission_mode: Some("default".to_string()),
        agent_channel_id: Some("channel-1".to_string()),
    };
    let args = build_claude_fork_args(&source, None);
    assert!(args.windows(2).any(|pair| pair == ["--resume", "source-session"]));
    assert_eq!(
        args.iter().filter(|arg| arg.as_str() == "--fork-session").count(),
        1
    );
}
```

Extend the existing finalization test: a Claude child stores `resolve_claude_transcript_path(source.working_directory, "child-session")`; a Codex child keeps a null transcript path.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml claude_fork
```

Expected: FAIL because the Fork argument builder and Provider transcript persistence do not exist.

- [ ] **Step 3: Build Claude launch configuration from trusted source fields**

Create a private `ClaudeRunRequest` using `ForkSourceThread` values, call `build_claude_run_args`, then append exactly one `--fork-session`. Resolve the channel runtime with `CLAUDE_CODE_PROVIDER_ID`, source channel/model/session, and pass only its backend-owned environment to `ClaudeSessionForkLaunch`.

```rust
fn build_claude_fork_args(
    source: &ForkSourceThread,
    channel_runtime: Option<&crate::agent_channels::AgentChannelRuntime>,
) -> Vec<String> {
    let payload = ClaudeRunRequest {
        thread_id: Some(source.id.clone()),
        turn_id: None,
        prompt: None,
        working_directory: Some(source.working_directory.clone()),
        session_id: Some(source.provider_thread_id.clone()),
        permission_mode: source.permission_mode.clone(),
        model: source.model.clone(),
        effort: source.reasoning_effort.clone(),
        channel_id: source.agent_channel_id.clone(),
        tool_result: None,
        content_blocks: None,
        automation_execution: false,
    };
    let permission_mode = normalize_claude_permission_mode(source.permission_mode.as_deref());
    let mut args = build_claude_run_args(&payload, &permission_mode, channel_runtime);
    args.push("--fork-session".to_string());
    args
}
```

The launch must not be inserted into `state.runtimes` or `state.runs`; it is isolated and must not replace the source runtime.

- [ ] **Step 4: Write failing API transaction and retry tests**

Extend `ThreadForkTestDriverState` with Claude create results and counts. Add API assertions:

```rust
assert_eq!(driver_state.claude_create_count, 1);
assert_eq!(driver_state.codex_create_count, 0);
assert_ne!(response["thread"]["sessionId"], "source-session");
assert_eq!(response["thread"]["provider"], CLAUDE_CODE_PROVIDER_ID);
assert_eq!(response["historyState"], "loaded");
```

Repeat the request with the same operation ID and assert create counts do not change. Add history-missing coverage: first response is `historyState = "pending"`, exactly one child is visible, and a later history read completes without another Claude Fork.

- [ ] **Step 5: Implement Provider creation and common finalization**

Dispatch after common operation preparation:

```rust
match source.provider.as_str() {
    OPENAI_CODEX_PROVIDER_ID => execute_codex_thread_fork(&state, &source, &operation).await,
    CLAUDE_CODE_PROVIDER_ID => execute_claude_thread_fork(&state, &source, &operation).await,
    _ => unreachable!("source validation rejects unsupported Providers"),
}
```

Claude rules:

1. `completed` and `history_pending` return the existing response without launch.
2. `result_unknown` returns conflict and never auto-launches.
3. Only `provider_pending` launches the one-shot process.
4. Persist the new session ID with `mark_fork_provider_succeeded` before transcript parsing.
5. Resolve and persist the child transcript path.
6. Parse with `parse_claude_transcript(path, Some(new_session_id))`.
7. Finalize loaded history in one transaction; use `finalize_thread_fork_without_history` while the transcript is absent.

Change `finalize_local_thread_fork` to accept `provider_transcript_path: Option<&str>`. Every Codex caller passes `None`; Claude passes the resolved path.

- [ ] **Step 6: Implement Provider-aware history-pending recovery**

In the thread-history endpoint, branch after `read_pending_fork_history_context`:

```rust
let turns = match source.provider.as_str() {
    OPENAI_CODEX_PROVIDER_ID => state
        .read_thread_fork_for_backend(
            source.control_config(),
            operation.operation_id.clone(),
            provider_thread_id.to_string(),
        )
        .await
        .map(|outcome| codex_snapshot_to_conversation_turns(
            &outcome.turns,
            &outcome.provider_thread_id,
            &source.working_directory,
        )),
    CLAUDE_CODE_PROVIDER_ID => read_claude_fork_transcript_turns(
        &source.working_directory,
        provider_thread_id,
    ),
    _ => unreachable!("source validation rejects unsupported Providers"),
}?;
```

`read_claude_fork_transcript_turns` requires the child transcript file to exist and parses it with the child session ID. Missing files remain recoverable conflicts; it never falls back to source SQLite messages.

- [ ] **Step 7: Run focused and cross-Provider tests for GREEN**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml claude_fork
cargo test --manifest-path src-tauri/Cargo.toml thread_fork
cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork
cargo test --manifest-path src-tauri/Cargo.toml claude_run_args
```

Expected: Claude create/retry/history tests and existing Codex/Claude args regressions pass.

- [ ] **Step 8: Record and commit Task 4**

```powershell
npm run trellis -- record "完成 Claude 原生 Fork 创建与恢复：新 session ID 先持久化，子 thread 原子创建，transcript pending 可恢复且不重复 Fork。"
git add -- src-tauri/src/backend.rs src-tauri/src/claude_session_fork.rs .trellis/tasks/claude-continue-in-new-chat.md .trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md
git commit -m "feat: fork Claude sessions into new chats"
```

## Task 5: Full Regression And Desktop Acceptance

**Files:**
- Modify: `.trellis/tasks/claude-continue-in-new-chat.md`
- Modify: `.trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md`

- [ ] **Step 1: Run the complete automated verification set**

```powershell
npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts
npm run typecheck
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork
cargo test --manifest-path src-tauri/Cargo.toml claude_fork
cargo test --manifest-path src-tauri/Cargo.toml thread_fork
cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork
cargo test --manifest-path src-tauri/Cargo.toml claude_run_args
git diff --check
```

Expected: every command exits 0 with no failed tests or formatting errors.

- [ ] **Step 2: Restart the desktop development app**

Stop only CodeM desktop development processes owned by this repository, then run `npm run desktop:dev`. Wait until the desktop shell and Rust backend are ready. Do not restart unrelated applications or remove `.tmp-dev/`.

- [ ] **Step 3: Verify the real Claude success path from both entries**

Using Claude Code 2.1.220 or newer:

1. Open an idle Claude thread with at least two completed turns.
2. Use the top menu “在新聊天中继续”.
3. Confirm the child opens with the source transcript and a different Claude session ID.
4. Send one child follow-up and confirm the source history does not change.
5. Use the sidebar context-menu action on the source and repeat the identity check.
6. Restart CodeM and confirm all threads retain correct history and independent session IDs.

Record only IDs, counts, status, and bounded errors; do not record transcript text or channel secrets.

- [ ] **Step 4: Verify gates and compatibility**

- Running Claude thread: disabled with “当前聊天正在运行”.
- Pending approval/user input: disabled with the matching reason.
- Missing session ID: disabled and no operation row.
- Unsupported help fixture: disabled with Claude upgrade guidance.
- Codex source: existing top/sidebar Fork path still works.
- Grok/OpenCode/Pi: generic unsupported reason.
- Repeated request: one Provider session and one local child.

- [ ] **Step 5: Record verification and complete Trellis**

Use `npm run trellis -- verify ...` for every actual command group and desktop evidence, including observed counts. Then run:

```powershell
npm run trellis -- complete --summary "完成 Claude Code 原生在新聊天中继续：共享现有双入口，使用 --resume + --fork-session 创建独立会话，覆盖能力降级、运行门禁、幂等事务、transcript 恢复与 Codex 回归。"
```

- [ ] **Step 6: Commit final acceptance records**

```powershell
git add -- .trellis/tasks/claude-continue-in-new-chat.md .trellis/workspace/sessions/session-20260802-110919-t3q9-claude-continue-in-new-chat.md
git commit -m "docs: record Claude thread fork acceptance"
```

Do not stage `.tmp-dev/` or unrelated user changes.

## Plan Self-Review

- Coverage includes both entries, capability, trusted identity, no-prompt native creation, distinct IDs, inheritance, runtime/pending gates, idempotency, Provider-success recovery, transcript-only history, restart, old CLI guidance, Codex regression, privacy, performance and real desktop acceptance.
- Frontend capability types and helpers are Provider-neutral from Task 1 onward.
- Backend keeps one shared route and operation table; only Provider transport and history source branch.
- No migration is planned because `source_thread_id` resolves the Provider and the operation table already stores source/child Provider IDs and all required states.
- Claude `result_unknown` never retries automatically because this scope has no safe provider listing/reconciliation contract.
- Checkpoint/rewind, background Agent control, Hooks UI, specified-turn branching, other Provider simulation and local message-copy fallback remain outside this plan.
