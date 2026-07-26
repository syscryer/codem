# Pi Agent RPC Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready Pi Agent Provider backed by Pi's native RPC protocol, including hot sessions, installation diagnostics, system/custom channels, model and thinking selection, CodeM permission bridging, settings integration, and truthful unsupported capability states.

**Architecture:** A new Rust `pi_rpc` module owns strict LF-delimited JSONL transport and Pi command/event types. `agent_run` adds a `PiRpc` driver to the existing thread-scoped runtime actor, while `agent_channels` prepares isolated Pi configuration for custom channels. Frontend code consumes the existing provider, model, channel, timeline, and settings contracts with Pi-specific probe data only where necessary.

**Tech Stack:** Rust 2021, Tokio, serde/serde_json, Axum, React 19, TypeScript strict mode, Node test runner with tsx, Tauri 2.

---

## File Map

- Create `src-tauri/src/pi_rpc.rs`: Pi process transport, commands, responses, state/model/session types, events, and unit tests.
- Create `src-tauri/resources/pi/codem-bridge.js`: Pi Extension that converts permission and UI requests into RPC extension UI messages.
- Modify `src-tauri/src/lib.rs`: export the Pi RPC module.
- Modify `src-tauri/src/agent_runtime.rs`: Pi provider ID, descriptor, capabilities, and registry tests.
- Modify `src-tauri/src/agent_run.rs`: Pi command discovery, driver input, event mapping, hot runtime lifecycle, abort behavior, and tests.
- Modify `src-tauri/src/agent_channels.rs`: Pi system channel, protocol validation, isolated custom-channel runtime, cleanup, and tests.
- Modify `src-tauri/src/backend.rs`: Pi settings diagnostics, install/update/version/probe routes, rules/skills/packages boundaries, and tests.
- Modify `src/types.ts`: Pi provider/probe types and provider-keyed records.
- Modify `src/constants.ts`: `PI_AGENT_PROVIDER_ID`.
- Modify `src/lib/agent-provider-registry.ts`: Pi probe API and generic runtime routing.
- Modify `src/lib/agent-provider-management.ts`: Pi status, diagnostics, install docs, capability copy, and model summaries.
- Modify `src/lib/agent-provider-registry.test.ts`: Pi registry/probe normalization tests.
- Modify `src/lib/agent-provider-management-ui.test.ts`: Pi settings-state tests.
- Modify `src/lib/agent-channel-selection.test.ts`: Pi channel model and continuity tests.
- Modify `src/hooks/useAgentChannels.ts`: Pi system default channel.
- Modify `src/hooks/useAgentRun.ts`: Pi unavailable copy and provider label.
- Modify `src/components/AgentProviderIcon.tsx`: Pi brand/fallback icon mapping.
- Modify `src/components/settings/AgentSettingsProviderTabs.tsx`: Pi tab.
- Modify `src/components/settings/AgentProviderSettings.tsx`: Pi probe, diagnostics, install/update, and model display.
- Modify `src/components/settings/AgentChannelSettings.tsx`: Pi channel protocols and labels.
- Modify `src/components/settings/McpSettings.tsx`: explicit Pi unsupported state.
- Modify `src/components/settings/GlobalPromptSettings.tsx`: Pi `AGENTS.md` paths.
- Modify `src/components/settings/UsageSettings.tsx`: Pi usage filter.
- Modify `src/components/settings/plugins/PluginsSuite.tsx`: Pi Packages and Skills wording/actions.
- Modify `.trellis/tasks/pi-agent-provider.md`: link plan and record final verification.

### Task 1: Register Pi As A First-Class Provider

**Files:**
- Modify: `src-tauri/src/agent_runtime.rs`
- Modify: `src/types.ts`
- Modify: `src/constants.ts`
- Modify: `src/lib/agent-provider-registry.ts`
- Test: `src-tauri/src/agent_runtime.rs`
- Test: `src/lib/agent-provider-registry.test.ts`

- [ ] **Step 1: Write failing Rust and TypeScript registry tests**

Add a Rust assertion that `agent_provider_registry(false, false, false, false, true)` contains:

```rust
let pi = registry
    .providers
    .iter()
    .find(|provider| provider.id == PI_AGENT_PROVIDER_ID)
    .expect("Pi provider");
assert_eq!(pi.driver_id, "pi-rpc");
assert_eq!(pi.lifecycle, AgentProviderLifecycle::Active);
assert_eq!(pi.available, Some(true));
assert!(pi.selectable);
assert_eq!(pi.capabilities.tools.mcp, AgentCapabilitySupport::Unsupported);
assert_eq!(pi.capabilities.runtime.cancel, AgentCancelSupport::Soft);
```

Add a TypeScript registry fixture containing `pi-agent` and assert:

```ts
assert.equal(resolveChatRuntimeKind('pi-agent'), 'generic');
assert.equal(normalizeAgentProviderRegistry(payload).providers.at(-1)?.driverId, 'pi-rpc');
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_runtime::tests
node --import tsx --test src/lib/agent-provider-registry.test.ts
```

Expected: failures because `PI_AGENT_PROVIDER_ID` and the fifth availability argument do not exist.

- [ ] **Step 3: Add provider IDs, descriptor, and capabilities**

Add:

```rust
pub const PI_AGENT_PROVIDER_ID: &str = "pi-agent";
```

Extend `agent_provider_registry` with `pi_available: bool` and create `pi_capabilities()` with create/resume/list, text/images/file references, streaming, bridge-backed approval/user input, unsupported MCP, soft cancel, reconnect, and concurrent sessions.

Add:

```ts
export const PI_AGENT_PROVIDER_ID = 'pi-agent';
export type AgentProviderId =
  | 'claude-code'
  | 'grok-build'
  | 'openai-codex'
  | 'opencode'
  | 'pi-agent';
```

Include Pi in `resolveChatRuntimeKind`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the commands from Step 2. Expected: PASS.

- [ ] **Step 5: Commit only Task 1 files**

```powershell
git add -- src-tauri/src/agent_runtime.rs src/types.ts src/constants.ts src/lib/agent-provider-registry.ts src/lib/agent-provider-registry.test.ts
git commit -m "feat: register Pi Agent provider"
```

### Task 2: Implement Strict Pi RPC Framing And Command Correlation

**Files:**
- Create: `src-tauri/src/pi_rpc.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/pi_rpc.rs`

- [ ] **Step 1: Write failing framing tests**

Cover fragmented input, multiple records, CRLF tolerance, U+2028/U+2029 inside strings, maximum line size, and malformed JSON:

```rust
#[tokio::test]
async fn pi_jsonl_reader_splits_only_on_lf() {
    let input = br#"{"type":"event","text":"a\u2028b"}\n{"type":"event","text":"c"}\n"#;
    let mut reader = PiJsonlReader::new(&input[..]);
    assert_eq!(reader.read_value().await.unwrap()["text"], "a\u{2028}b");
    assert_eq!(reader.read_value().await.unwrap()["text"], "c");
}
```

Add a response router test where an event arrives between two command responses and each response resolves only its matching request ID.

- [ ] **Step 2: Run the test and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pi_rpc
```

Expected: compile failure because `pi_rpc` does not exist.

- [ ] **Step 3: Implement bounded LF JSONL transport**

Create:

```rust
pub const MAX_PI_RPC_LINE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PI_STDERR_TAIL_BYTES: usize = 64 * 1024;

pub struct PiJsonlReader<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: AsyncRead + Unpin> PiJsonlReader<R> {
    pub async fn read_value(&mut self) -> Result<Value, PiRpcError>;
}
```

The reader must scan bytes for `b'\n'`, strip one trailing `b'\r'`, reject oversized records before parsing, and return EOF only when no buffered bytes remain.

Define typed envelopes:

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PiRpcEnvelope {
    Response(PiRpcResponse),
    #[serde(other)]
    Event,
}
```

Use a dedicated stdout task with a pending `HashMap<String, oneshot::Sender<_>>` and an unbounded event channel.

- [ ] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: all `pi_rpc` framing/correlation tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri/src/pi_rpc.rs src-tauri/src/lib.rs
git commit -m "feat: add Pi RPC transport"
```

### Task 3: Add Typed Pi State, Models, Events, And Process Client

**Files:**
- Modify: `src-tauri/src/pi_rpc.rs`
- Test: `src-tauri/src/pi_rpc.rs`

- [ ] **Step 1: Write failing protocol tests**

Use a temporary fake executable/script that:

- accepts `get_state`, `get_available_models`, `get_available_thinking_levels`, `set_model`, `set_thinking_level`, `prompt`, and `abort`;
- emits `message_update`, tool events, `agent_end`, and `agent_settled`;
- records received commands to a temporary file.

Assert:

```rust
let state = client.get_state().await.unwrap();
assert_eq!(state.session_id, "session-1");
assert_eq!(client.available_models().await.unwrap()[0].id, "model-1");
assert_eq!(client.available_thinking_levels().await.unwrap(), vec!["off", "high"]);
client.abort().await.unwrap();
```

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pi_rpc::tests::client_
```

Expected: missing client methods/types.

- [ ] **Step 3: Implement `PiStdioClient`**

Expose:

```rust
pub struct PiStdioClient { /* child, stdin, pending, events, stderr tail */ }

impl PiStdioClient {
    pub async fn spawn_with_options(
        program: &str,
        cwd: &Path,
        env: &BTreeMap<String, String>,
        args: &[String],
    ) -> Result<Self, PiRpcError>;
    pub async fn get_state(&mut self) -> Result<PiState, PiRpcError>;
    pub async fn get_available_models(&mut self) -> Result<Vec<PiModel>, PiRpcError>;
    pub async fn get_available_thinking_levels(&mut self) -> Result<Vec<String>, PiRpcError>;
    pub async fn set_model(&mut self, provider: &str, model_id: &str) -> Result<(), PiRpcError>;
    pub async fn set_thinking_level(&mut self, level: &str) -> Result<(), PiRpcError>;
    pub async fn prompt(&mut self, input: PiPromptInput) -> Result<(), PiRpcError>;
    pub async fn steer(&mut self, input: PiPromptInput) -> Result<(), PiRpcError>;
    pub async fn follow_up(&mut self, input: PiPromptInput) -> Result<(), PiRpcError>;
    pub async fn abort(&mut self) -> Result<(), PiRpcError>;
    pub async fn extension_ui_response(&mut self, response: Value) -> Result<(), PiRpcError>;
    pub async fn next_event(&mut self) -> Result<PiRuntimeEvent, PiRpcError>;
    pub fn is_running(&mut self) -> bool;
    pub async fn shutdown(self);
}
```

Parse model input modalities, context window, reasoning support, usage/cost, stop reason, tool content, queue/retry/compaction status, and Extension UI requests. Preserve unknown events as bounded summaries.

- [ ] **Step 4: Run protocol tests**

Run the command from Step 2 and then:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pi_rpc
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri/src/pi_rpc.rs
git commit -m "feat: model Pi RPC commands and events"
```

### Task 4: Integrate Pi With The Hot Agent Runtime

**Files:**
- Modify: `src-tauri/src/agent_run.rs`
- Test: `src-tauri/src/agent_run.rs`

- [ ] **Step 1: Write failing runtime tests**

Add tests proving:

```rust
assert_eq!(
    runtime_status_message(PI_AGENT_PROVIDER_ID, AgentDriverKind::PiRpc, true, false),
    "已复用 Pi 热会话"
);
```

Add fake-client actor tests for:

- identical runtime config reuses one process;
- `abort` ends the run but leaves runtime phase `ready`;
- model, thinking, channel fingerprint, permission mode, or bridge version changes replace the idle runtime;
- `agent_end` does not emit `Done`;
- `agent_settled` emits exactly one `Done`;
- a fatal protocol error marks runtime failed and the next dispatch restores the validated session without replaying the previous prompt.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::pi_
```

Expected: compile/test failures because Pi driver/runtime variants do not exist.

- [ ] **Step 3: Add Pi driver, input, config, and runtime variants**

Add:

```rust
enum AgentDriverKind { Acp, CodexAppServer, PiRpc }
enum AgentDriverInput { Acp(Vec<AcpPromptInput>), Codex(Vec<CodexUserInput>), Pi(PiPromptInput) }
enum LiveAgentRuntime {
    Acp { /* existing */ },
    Codex { /* existing */ },
    Pi { client: PiStdioClient, session_id: String },
}
```

Extend command resolvers with `pi`, include `bridge_version` in `AgentRuntimeConfig`, and add Pi to command discovery.

Start Pi with `--mode rpc`, optional `--session`, CodeM bridge `-e`, model, thinking, and channel environment. Call `get_state` before persisting session data.

- [ ] **Step 4: Map Pi events and terminal semantics**

Implement a focused `PiEventMapper`:

```rust
match event {
    PiRuntimeEvent::TextDelta(text) => AgentRunEvent::Delta { run_id, text },
    PiRuntimeEvent::ThinkingDelta(text) => AgentRunEvent::ThinkingDelta { run_id, text },
    PiRuntimeEvent::ToolStart { .. } => AgentRunEvent::ToolStart { .. },
    PiRuntimeEvent::ToolEnd { .. } => AgentRunEvent::ToolResult { .. },
    PiRuntimeEvent::AgentSettled => terminal_outcome,
    _ => status_or_no_event,
}
```

On CodeM cancel, send RPC `abort`; hard-kill only after timeout or failed command. Keep the client for the next turn after successful abort.

- [ ] **Step 5: Run runtime and regression tests**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::pi_
cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src-tauri/src/agent_run.rs
git commit -m "feat: run Pi RPC in hot sessions"
```

### Task 5: Add Pi System And Isolated Custom Channels

**Files:**
- Modify: `src-tauri/src/agent_channels.rs`
- Modify: `src/hooks/useAgentChannels.ts`
- Test: `src-tauri/src/agent_channels.rs`
- Test: `src/lib/agent-channel-selection.test.ts`
- Test: `src/hooks/useAgentChannels.test.ts`

- [ ] **Step 1: Write failing channel tests**

Cover:

- Pi accepts `openai_chat`, `openai_responses`, and `anthropic_messages`;
- bootstrap always includes Pi system channel and default `"system"`;
- custom channel creates a thread-scoped Pi directory;
- generated configuration references an environment variable instead of embedding the secret in model config;
- fingerprints change when secret/model/channel update changes;
- deleting the channel removes only its Pi runtime directory.

Example:

```rust
assert!(validate_protocol(PI_AGENT_PROVIDER_ID, AiProtocol::OpenaiChat).is_ok());
assert!(validate_protocol(PI_AGENT_PROVIDER_ID, AiProtocol::AnthropicMessages).is_ok());
assert!(!config_text.contains("sk-secret"));
assert_eq!(runtime.env["PI_CODING_AGENT_DIR"], expected_dir.to_string_lossy());
```

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests::pi_
node --import tsx --test src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts
```

- [ ] **Step 3: Implement Pi channel preparation**

Add `read_pi_system_channel()` using `~/.pi/agent/settings.json` and `models.json` without reading `auth.json`.

Add `prepare_pi_runtime_dir` that creates:

```text
<app-data>/agent-runtimes/pi/<thread-or-channel>/
  settings.json
  models.json
  extensions/codem-bridge.js
```

Put the secret only in the child environment using a generated variable name, and configure Pi model auth to reference that variable where supported. Reject protocols that cannot be represented safely.

- [ ] **Step 4: Run channel tests**

Run commands from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri/src/agent_channels.rs src/hooks/useAgentChannels.ts src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts
git commit -m "feat: add Pi Agent channels"
```

### Task 6: Add Pi Installation, Probe, Models, And Settings Management

**Files:**
- Modify: `src-tauri/src/backend.rs`
- Modify: `src-tauri/src/agent_run.rs`
- Modify: `src/types.ts`
- Modify: `src/lib/agent-provider-registry.ts`
- Test: `src-tauri/src/backend.rs`
- Test: `src/lib/agent-provider-registry.test.ts`

- [ ] **Step 1: Write failing lifecycle and probe tests**

Assert:

```rust
let plan = build_agent_lifecycle_plan(PI_AGENT_PROVIDER_ID, "install", None).unwrap();
assert_eq!(plan.program, "npm");
assert_eq!(
    plan.args,
    vec!["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent@latest"]
);
assert!(lifecycle_plan_supports_npm_mirror(&plan));
```

Add Node version tests for `22.18.0` rejected and `22.19.0` accepted. Add Pi probe normalization tests for installed/uninitialized/authenticated/model counts.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml backend::tests::pi_
node --import tsx --test src/lib/agent-provider-registry.test.ts
```

- [ ] **Step 3: Implement lifecycle and diagnostics**

Add Pi to:

- provider allowlists;
- command resolution (`PI_CLI_PATH`, then `pi`);
- settings config path (`~/.pi/agent`);
- install package and latest-version lookup;
- update plan (`pi update --self`);
- proxy/mirror retry eligibility;
- diagnostics response.

Probe by starting Pi RPC, calling `get_state`, `get_available_models`, and `get_available_thinking_levels`, then shutting down. Never return credential values.

- [ ] **Step 4: Implement model catalog**

Convert Pi models to `AgentModelCatalog`:

```rust
AgentModelSummary {
    id: format!("{}/{}", model.provider, model.id),
    label: model.name,
    description: Some(model.provider),
    context_window_tokens: Some(model.context_window),
    is_default: state.model.as_ref().is_some_and(|current| current == &model),
    default_reasoning_effort: Some(state.thinking_level.clone()),
    supported_reasoning_efforts: thinking_levels.clone(),
}
```

Cache through the existing short-TTL model catalog path.

- [ ] **Step 5: Implement rules, Skills, Packages, MCP, and usage boundaries**

Add Pi to the validated provider allowlists and map:

- global rules to `~/.pi/agent/AGENTS.md`;
- project rules to `<project>/AGENTS.md`;
- global Skills to `~/.pi/agent/skills`;
- project Skills to `<project>/.pi/skills`;
- installed Pi Packages to `pi list`;
- package installation to `pi install <source>`;
- package removal to `pi remove <source>`;
- package update to `pi update <source>`;
- usage filtering to the existing provider-agnostic aggregation.

Return a stable `400` response for Pi MCP read/write endpoints:

```rust
if provider_id == PI_AGENT_PROVIDER_ID {
    return Err(ApiError::bad_request(
        "Pi Agent 当前不支持由 CodeM 管理 MCP",
    ));
}
```

Package command output must pass through the existing bounded credential sanitizer. Do not expose `auth.json` through file-opening or settings APIs.

- [ ] **Step 6: Run lifecycle/model/settings tests**

Run Step 2 commands and:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml backend::tests::agent_lifecycle
```

- [ ] **Step 7: Commit**

```powershell
git add -- src-tauri/src/backend.rs src-tauri/src/agent_run.rs src/types.ts src/lib/agent-provider-registry.ts src/lib/agent-provider-registry.test.ts
git commit -m "feat: manage Pi Agent lifecycle"
```

### Task 7: Add The CodeM Pi Bridge Extension

**Files:**
- Create: `src-tauri/resources/pi/codem-bridge.js`
- Modify: `src-tauri/src/pi_rpc.rs`
- Modify: `src-tauri/src/agent_run.rs`
- Test: `src-tauri/src/pi_rpc.rs`
- Test: `src-tauri/src/agent_run.rs`

- [ ] **Step 1: Write failing Extension UI tests**

Feed these requests through the fake Pi process:

```json
{"type":"extension_ui_request","id":"confirm-1","method":"confirm","title":"运行命令","message":"npm test"}
{"type":"extension_ui_request","id":"input-1","method":"input","title":"请输入值","placeholder":"value"}
```

Assert they become CodeM `ApprovalRequest` and `RequestUserInput`, and that approved/rejected/cancelled answers write the matching `extension_ui_response` to the same process.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml pi_rpc::tests::extension_ui_
cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::pi_extension_
```

- [ ] **Step 3: Implement the bridge asset**

The extension must:

- read `CODEM_PI_PERMISSION_MODE`;
- intercept side-effecting tools (`write`, `edit`, `bash`) in `default`;
- allow them in `auto` and `bypassPermissions`;
- use `ctx.ui.confirm` with bounded command/path summaries;
- return a blocked tool result when rejected;
- never include environment values or file contents in confirmation copy.

Load it with Pi `-e <path>` after writing `include_str!("../resources/pi/codem-bridge.js")` to the isolated runtime directory.

- [ ] **Step 4: Map Extension UI control responses**

Use the existing `AgentControlCommand::Permission` and `UserInput` channels. Validate request IDs, accept one response only, and send cancellation when the CodeM request is dismissed.

- [ ] **Step 5: Run tests**

Run Step 2 commands. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src-tauri/resources/pi/codem-bridge.js src-tauri/src/pi_rpc.rs src-tauri/src/agent_run.rs
git commit -m "feat: bridge Pi permissions and user input"
```

### Task 8: Complete Pi Frontend Settings And Capability Surfaces

**Files:**
- Modify: `src/components/AgentProviderIcon.tsx`
- Modify: `src/components/settings/AgentSettingsProviderTabs.tsx`
- Modify: `src/components/settings/AgentProviderSettings.tsx`
- Modify: `src/components/settings/AgentChannelSettings.tsx`
- Modify: `src/components/settings/McpSettings.tsx`
- Modify: `src/components/settings/GlobalPromptSettings.tsx`
- Modify: `src/components/settings/UsageSettings.tsx`
- Modify: `src/components/settings/plugins/PluginsSuite.tsx`
- Modify: `src/hooks/useAgentRun.ts`
- Modify: `src/lib/agent-provider-management.ts`
- Test: `src/lib/agent-provider-management-ui.test.ts`

- [ ] **Step 1: Write failing UI behavior tests**

Assert:

- Pi status is 未安装 / 待处理 / 已检测 based on probe;
- install docs resolve to `https://pi.dev/docs/latest/quickstart`;
- provider label is `Pi`;
- Pi MCP capability copy is `不支持`;
- Pi global rules resolve to `~/.pi/agent/AGENTS.md`;
- Pi Skills path resolves to `~/.pi/agent/skills`;
- Pi appears in usage filters and provider tabs.

- [ ] **Step 2: Run and verify RED**

```powershell
node --import tsx --test src/lib/agent-provider-management-ui.test.ts
npm run typecheck
```

- [ ] **Step 3: Add Pi probe and provider settings**

Create `PiRpcProbeResult` types and `probePiAgent()`. Add Pi state fields/controllers to `AgentProviderSettings` following the Codex/OpenCode pattern, keeping requests abortable and preserving prior diagnostic data during refresh.

- [ ] **Step 4: Add channel, rule, package, MCP, usage, and icon surfaces**

Use existing theme variables and provider components. Do not create Pi-only card styling. Display:

- Packages and Skills using Pi terminology;
- MCP as an explicit unsupported empty state with no mutation controls;
- system/custom channel support;
- dynamic models and thinking levels.

- [ ] **Step 5: Run tests and typecheck**

Run Step 2 commands plus:

```powershell
node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-model-selection.test.ts
```

- [ ] **Step 6: Commit**

```powershell
git add -- src/components src/hooks/useAgentRun.ts src/lib/agent-provider-management.ts src/lib/agent-provider-management-ui.test.ts src/types.ts
git commit -m "feat: add Pi Agent settings experience"
```

### Task 9: Verify End-To-End Behavior And Close Trellis

**Files:**
- Modify: `.trellis/tasks/pi-agent-provider.md`
- Modify: `.trellis/workspace/sessions/session-20260726-042200-lmp6-pi-agent-provider.md`

- [ ] **Step 1: Run focused frontend tests**

```powershell
node --import tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts
npm run typecheck
```

Expected: all tests pass and TypeScript emits no errors.

- [ ] **Step 2: Run Rust formatting and focused tests**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml pi_rpc
cargo test --manifest-path src-tauri/Cargo.toml agent_run
cargo test --manifest-path src-tauri/Cargo.toml agent_channels
cargo test --manifest-path src-tauri/Cargo.toml backend
```

Expected: PASS.

- [ ] **Step 3: Run full regression suite**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all non-ignored tests pass; no whitespace errors.

- [ ] **Step 4: Restart desktop development mode**

Stop only the existing CodeM desktop dev launcher/processes, then run:

```powershell
npm run desktop:dev
```

Verify backend health and the actual ports reported by the launcher:

```powershell
Invoke-RestMethod http://127.0.0.1:<backend-port>/api/health
```

- [ ] **Step 5: Run real Pi smoke verification**

With an authenticated Pi installation:

- open Agent 设置 and run Pi detection;
- create a Pi thread;
- send a prompt that emits text, thinking, and a read-only tool;
- send a second prompt and verify the same runtime is reused;
- stop a third prompt and verify the following prompt still reuses the runtime;
- change model or channel and verify a controlled runtime replacement;
- confirm no secret/base64 data appears in debug events.

- [ ] **Step 6: Record Trellis verification and completion**

```powershell
npm run trellis -- verify "<exact command>" --result "<actual result>"
npm run trellis -- record "完成 Pi RPC 热会话、渠道、设置和权限桥接实现"
npm run trellis -- complete --summary "完成 Pi Agent 原生 RPC 接入及热会话验证"
```

- [ ] **Step 7: Commit final records without unrelated files**

```powershell
git add -- .trellis/tasks/pi-agent-provider.md .trellis/workspace/sessions/session-20260726-042200-lmp6-pi-agent-provider.md
git commit -m "docs: complete Pi Agent RPC task"
```
