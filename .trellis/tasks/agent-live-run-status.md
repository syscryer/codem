# Task: 通用 Agent 实时运行状态与计时

## Background

Grok ACP 与 OpenAI Codex app-server 已按 CodeM thread 保留常驻 Provider runtime，
但前端仍只用 Claude Code hook 的时钟驱动进度刷新，通用 Agent 运行时会长期停在 `0s`。
同时，Grok 的 thought chunk 被映射层丢弃，Codex app-server 的 turn/reasoning 通知也未投影为统一 phase；
底部会话状态只查询 Claude runtime，因此通用 Agent 回答完成后显示为普通“空闲”，无法识别仍可复用的热连接。

## Objective

让 Codex 与 Grok 热会话实时展示连接、思考、工具执行、生成回复和持续递增耗时，完成后回到热连接并保留实际耗时

## Scope

In scope:

- 通用 Agent hook 在任一 Grok/Codex run 活跃时每秒刷新运行时钟，完成后固定实际耗时。
- `AgentRunEvent` 增加与 Claude 兼容的 phase 事件，覆盖连接、思考、工具执行和生成回复。
- Grok ACP 的 thought chunk 与 Codex app-server 的 turn/reasoning/plan 通知只投影状态，不暴露隐藏思考文本。
- 增加通用 Agent runtime 列表接口，并与 Claude runtime 状态合并供侧边栏、会话管理和底部状态使用。
- 底部会话状态支持 Grok/Codex 热连接、当前运行、连接重置和 Provider 协议信息。

Out of scope:

- 不展示或持久化隐藏思维链、reasoning 原文或 Provider 原始协议消息。
- 不改变 Provider session 复用、模型、权限、审批、提问、队列和取消语义。
- 不新增通用 Agent run 刷新重连能力，也不增加 runtime 闲置 TTL。

## Impact

- Backend：`agent_runtime.rs`、`agent_run.rs`、`acp.rs`、`codex_app_server.rs` 的事件与 runtime 状态契约。
- Frontend：`useAgentRun.ts`、`App.tsx`、`WorkspaceStatus.tsx`、runtime status helper 与类型。
- Persistence：不新增字段；完成耗时继续写入现有 `ConversationTurn.durationMs`。
- Security/privacy：仅传 phase 名称和计数，不传 thought/reasoning 文本。

## Acceptance Criteria

- [x] Codex/Grok 运行中进度条耗时每秒递增，完成后显示固定实际耗时。
- [x] 首次启动和热复用都能从连接状态进入思考状态，文本输出和工具调用继续切换现有 phase。
- [x] Grok thought chunk 与 Codex turn/reasoning 通知显示“思考中”，且事件与历史中没有隐藏思考文本。
- [x] Codex/Grok runtime 完成 turn 后显示“热连接”，运行中显示“运行中”，关闭后回到“空闲”。
- [x] 侧边栏与会话管理能识别通用 Agent 的热 runtime，不影响 Claude runtime 状态。
- [x] 重置 Grok/Codex 热连接调用通用 Agent DELETE 接口，Claude 仍使用原接口。
- [x] 现有热会话、取消、队列、审批、提问和多模态测试保持通过。

### 2026-07-15 失焦完成提示修复

- [x] 当前会话在窗口失焦期间完成时，侧栏保留待查看完成小点。
- [x] 本地实时运行状态仍高于完成提示，轮询得到的陈旧 activeRun 不再遮住终态通知。
- [x] 窗口聚焦且正在查看当前会话时不产生多余完成小点。
- [x] 用户重新选择会话后清除完成提示，现有热会话图标和系统通知行为保持不变。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node --test --import tsx src/lib/agent-run-events.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/sidebar-thread-status.test.ts src/lib/workspace-session-status.test.ts src/components/WorkspaceStatus.panel.test.ts`
- `npm run typecheck`
- `git diff --check`
- 真实 Codex/Grok 运行：观察连接、思考、工具/生成、递增耗时、完成热连接状态。

## Implementation Record

- 2026-07-15T06:23:08.985Z 修复完成：当前会话仅在窗口聚焦时忽略完成通知；失焦时保留待查看状态，侧栏状态优先级调整为本地实时运行、终态通知、轮询运行、热连接。
- 2026-07-15T06:04:36.894Z 红灯验证：thread-activity-notices 与 sidebar-thread-status 共 11 项中新增 2 项失败；失焦当前会话通知被丢弃，终态通知被陈旧 runtime activeRun 遮住。

- 2026-07-15T06:02:27.978Z 调试证据：当前完成通知会无条件忽略 activeThreadId，未考虑窗口失焦；侧栏又让轮询 runtimeStatus.activeRun 高于终态通知，后台定时器被节流时旧运行态会遮住完成小点。修复将让失焦的当前会话保留通知，并让本地实时 running 最高、终态通知次之、轮询 activeRun 再次之。
- 2026-07-13T15:13:10.184Z 完成通用 Agent 实时状态链路：Rust 统一 phase 事件，Codex reasoning/plan 与 Grok thought 仅映射为思考状态且不透传内容；前端增加通用 Agent 每秒时钟；侧边栏、底部状态与会话管理合并 Claude 和通用 Agent runtime，完成后展示热连接并支持重置。

- 2026-07-13T14:12:27.669Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T06:24:07.343Z `node --test --import tsx src/lib/agent-run-events.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/sidebar-thread-status.test.ts src/lib/workspace-session-status.test.ts src/components/WorkspaceStatus.panel.test.ts src/lib/thread-activity-notices.test.ts src/lib/thread-system-notifications.test.ts`: 通过：Agent、运行态、侧栏与系统通知相关测试 39/39
- 2026-07-15T06:23:09.941Z `git diff --check`: 通过：无空白错误

- 2026-07-15T06:23:09.630Z `npm run typecheck`: 通过：TypeScript 无错误
- 2026-07-15T06:23:09.309Z `node --test --import tsx src/lib/thread-activity-notices.test.ts src/lib/sidebar-thread-status.test.ts src/lib/thread-system-notifications.test.ts`: 通过：17/17

- 2026-07-13T15:13:45.179Z `Playwright 真实 UI 会话`: 通过：运行中显示思考中并持续递增到 65s，完成固定为已处理 96s；后续热轮固定 10s；底部和侧边栏均显示热连接。
- 2026-07-13T15:13:44.399Z `真实 Grok 冷启动与热复用 API`: 通过：冷轮约 21.4s、热轮约 4.7s；sessionId 保持一致；thought 仅映射 thinking 状态且无内容泄露；完成后 runtime phase=ready。

- 2026-07-13T15:13:43.553Z `真实 Codex 冷启动与热复用 API`: 通过：冷轮约 24.4s、热轮约 14.0s；sessionId 保持一致；事件含 thinking/tool/delta/done，不含 reasoning 原文；完成后 runtime phase=ready。
- 2026-07-13T15:13:42.769Z `npm run typecheck && 定向前端测试`: 通过：TypeScript 无错误，agent/runtime/status 相关定向测试 24/24。

- 2026-07-13T15:13:41.902Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 54 passed、1 ignored；desktop main 9 passed；无失败。
- 2026-07-13T15:13:41.063Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。

## Completion Summary

- 2026-07-15T06:24:07.637Z 修复窗口失焦期间当前 Agent 会话完成后侧栏没有待查看小点的问题：完成通知现在依据真实窗口焦点决定是否保留，终态通知可以覆盖后台节流造成的陈旧轮询运行态，同时保持本地实时运行优先、聚焦查看不产生多余提示、重新选择会话后清除提示。相关测试 39/39、TypeScript 类型检查与差异检查通过。
- 2026-07-13T15:15:00.788Z 完成 Codex/Grok 通用 Agent 实时状态与计时：运行中每秒递增并显示连接、思考、工具和生成阶段；结束后固定实际耗时并保留热连接；runtime 状态已统一接入侧边栏、底部和会话管理；真实冷启动、热复用和 UI 验证均通过，且未暴露隐藏思考内容。

## Follow-ups

- 通用 Agent 页面刷新后的 active run 重连仍按独立任务处理。
