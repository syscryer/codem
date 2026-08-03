# Task: Claude 在新聊天中继续

## Background

CodeM 已为 Codex 完成“在新聊天中继续”：顶部更多菜单和侧边栏右键菜单共用同一入口，
后端通过 Provider 原生 Fork 创建独立会话，并用本地操作记录保证幂等、失败恢复和原子落库。
Claude Code 当前已有热会话、`--resume`、历史导入、审批和用户输入闭环，但该入口仍明确限制为
Codex，Claude 聊天无法从当前上下文创建独立分支。

本机 Claude Code 2.1.220 已公开 `--fork-session`：与 `--resume <sessionId>` 一起使用时，
保留原会话上下文并创建新的原生 session ID。CodeM 后端目前只在普通恢复中传递 `--resume`，
没有传递 `--fork-session`，也没有把新 session ID 绑定到新的 CodeM thread。

## Objective

复用现有会话菜单，通过 Claude 原生 --resume 与 --fork-session 创建独立的新聊天，并覆盖能力降级、状态门禁和恢复语义

## Chosen Design (2026-08-03 snapshot-copy revision)

用户确认采用与 Codex 体验一致的“复制会话”语义：点击时固定复制当前可见历史和可信配置，
新聊天从创建完成起不再同步源聊天。Claude CLI 仍无法在没有真实 prompt 时提前物化原生
Fork session，因此 Provider session 在新聊天第一条真实消息时通过 `--resume + --fork-session`
创建；这是内部延迟绑定，不改变用户看到的固定历史快照。

### Product behavior

- 顶部更多菜单和侧边栏右键菜单继续共用现有“在新聊天中继续”入口。
- 点击后不启动 Claude CLI、不发送 prompt、不产生模型调用；后端在单个事务中创建独立的本地
  子 thread、复制当前 SQLite messages/tool_calls 历史快照并更新 selection。
- 复制完成后子聊天只读取自己的历史；源聊天后续消息不会进入子聊天，子聊天后续内容也不会
  修改源聊天。源 runtime、队列、审批和用户输入状态不复制。
- `thread_fork_operations.source_thread_id` 只作为首条消息可信绑定和幂等恢复所需的内部记录，
  不用于历史投影，不向前端暴露，也不改变复制完成后的 UI 独立性。
- 子聊天发送第一条真实用户消息时，后端从数据库可信读取源 session、工作目录、渠道、模型、effort
  和权限，启动普通 Claude stream-json runtime，并追加
  `--resume <sourceSessionId> --fork-session`；写入 stdin 的唯一初始消息就是用户实际发送的内容。
- 收到 `system/init` 后校验新 session ID 非空且不等于源 ID，原子绑定子 thread 和 operation；
  首轮运行完成后从新 transcript 幂等归一化历史，结束源历史投影并进入普通 Claude 热会话语义。

### State model

`awaiting_first_message -> provider_pending -> completed`

- `awaiting_first_message`：本地子 thread 和固定历史快照已创建，Provider session 尚未创建。
- `provider_pending`：首条消息已原子占用且 Claude 进程可能已经启动；并发发送直接拒绝，重启时保守
  恢复为 `result_unknown`。
- `completed`：`system/init` 已确认不同于源的 child session；固定快照继续保留，子 transcript 只合并
  点击边界后的新轮次。旧版 eager Fork 遗留的 `provider_succeeded/history_pending` 仍只用于兼容恢复。
- `failed`：CLI 进程尚未启动前的确定性失败，可在同一子 thread 上安全重试首条消息。
- `result_unknown`：真实消息已经写入或 Provider 进程已可能创建 session，但未确认 `init`；禁止自动
  重发用户消息或再次 Fork，只允许只读核对/人工恢复，避免重复会话和重复模型调用。

### Data flow

1. 能力端点继续从数据库读取源 thread 的真实 Provider/session/runtime 状态，并探测 CLI
   `--fork-session` 支持；客户端不能伪造 Provider、session ID、工作目录或渠道。
2. `/fork` 对 Claude 在同一事务创建 `awaiting_first_message` operation、本地子 thread、固定历史
   快照和 selection；同一 operation ID/同一源 thread 重复点击幂等返回同一个子 thread，绝不启动
   Provider。
3. 子 thread 的 bootstrap/history 只读取自己的 SQLite 历史；响应不暴露 pending Fork 状态，前端
   按普通已加载历史接入，不复制或拼接源 timeline。
4. `/api/claude/run` 仅在数据库确认目标为 `awaiting_first_message` 子 thread 时，把可信源 session
   转换为本次运行的 `--resume + --fork-session` 参数；普通 Claude run 参数保持不变。
5. `system/init` 先绑定新 session ID 和 transcript 路径，再允许 operation 从 Provider pending 路径
   进入历史恢复；首轮 assistant 成功或失败都不得回退到源 session。
6. 首轮结束或后续 history 请求从新 transcript 幂等合并独立历史，按稳定 turn/message ID 去重。
   刷新/重启继续按数据库 operation 状态恢复，不重复发送首条消息。

### Failure, security and privacy

- 源 thread 运行中、启动中、等待审批/用户输入或已有活动 Fork 时仍拒绝创建待分叉子 thread。
- 子 thread 首条消息并发、队列发送和重复请求必须单飞；只有一个运行可以消费
  `awaiting_first_message` 并追加 `--fork-session`。
- CLI spawn 前的确定性错误保持可重试；spawn 后取消、stdin 写入后断流、超时或 EOF 未见 init
  一律保守标记 `result_unknown`，不能把同一用户消息自动发送第二次。
- `system/init` 返回源 session ID、空 ID 或可信字段不匹配时拒绝绑定；源 session/runtime/history
  始终不被修改或关闭。
- operation、trace、debug/raw events 只记录状态和有界摘要，不保存渠道密钥、完整命令环境、
  transcript 全文或重复用户内容。
- Claude 普通发送、恢复、Compact、审批、用户输入、附件/内容块和 Codex Fork 行为保持不变。

### Alternatives considered

1. **固定历史快照 + 首条真实消息 Fork（采用）**：点击时立刻得到独立副本，无隐藏模型调用；
   Provider session 在第一条真实消息时绑定，但不再同步或投影源历史。
2. **暂时禁用 Claude Fork**：风险最低，但用户没有该功能。
3. **等待 Claude 提供零输入 Fork 协议**：未来最接近 Codex 点击即 Fork，但当前没有可交付价值。

### Known Claude CLI boundary

Claude 官方 CLI 只说明 `--fork-session` 会在 `--resume` / `--continue` 启动时创建新 session，当前没有
“不发送 prompt 即在点击时创建 checkpoint”的公开协议。因此 CodeM 能严格保证的是：点击时固定复制
可见历史，后续历史永不从源聊天增量同步；Provider 原生上下文则在子聊天首条真实消息启动时分叉。
如果用户在两者之间继续源 Claude session，模型侧上下文切点可能晚于 UI 快照时间。CodeM 不通过隐藏
prompt、伪造 transcript 或额外模型调用掩盖这个 CLI 边界。

## Scope

In scope:

- Claude 点击 Fork 时创建幂等的 `awaiting_first_message` 本地子 thread。
- 子 thread 创建时固定复制源历史，之后只读写自己的历史；首条真实消息后绑定新 Claude transcript。
- 首条消息运行的可信 `--resume + --fork-session` 参数、init 绑定、单飞、取消和恢复语义。
- 刷新/重启后的历史快照和新 session 恢复。
- 顶部菜单、侧边栏右键、普通 Claude、Codex 和旧 CLI 回归。

Out of scope:

- 不支持从指定历史轮次分叉，只支持源会话当前完整上下文。
- 不共享源 runtime、队列、审批或用户输入状态；只复制已持久化的可见历史快照。
- 不发送空消息、`/context`、隐藏 prompt 或额外模型请求来提前物化 session。
- 不为 Grok、OpenCode、Pi 或普通聊天模拟 Fork。
- 不新增分叉树、独立页面、checkpoint/rewind、后台 Agent、Hooks UI 或会话命名。

## Impact

- Frontend：继续复用共享 Fork response/thread 类型；Claude 复制响应直接返回 loaded 历史，现有两个
  菜单入口不新增第三套逻辑或 pending 状态展示。
- Backend：Fork endpoint、本地 operation/thread/history 事务、Claude run
  首条消息参数和 init/exit 持久化。
- Persistence：优先扩展 `thread_fork_operations.status` 的允许值并复用现有 source/local/provider ID；
  只有确实无法恢复首条消息状态时才增加最小字段和兼容迁移。
- Performance：历史快照在后端事务内写入一次；前端不得复制整棵源 timeline 或因标签切换重复解析大 transcript。

## Acceptance Criteria

- [x] 空闲且有有效 Claude session 的源 thread 可从顶部菜单和侧边栏右键创建同一个幂等子 thread；
  点击本身不启动 Claude CLI、不产生 session、prompt 或模型调用。
- [x] 子 thread 立即打开并展示与源 thread 一致的可见历史，历史快照独立写入子 thread；
  源 thread 的 session、history、runtime、队列和 selection 外状态不变。
- [x] 复制完成后源 thread 的新历史不会进入子 thread，子 thread 的后续修改也不会影响源 thread。
- [x] 子 thread 第一条真实文本、图片或附件消息完整保留 content blocks，并且只发送一次；真实参数包含
  `--resume <sourceSessionId> --fork-session`，普通 Claude run 不包含 `--fork-session`。
- [x] 新 `system/init` session ID 非空且不同于源 ID；子 thread 绑定新 session/transcript，首轮完成后
  历史来自新 transcript 且无重复 user/assistant/tool turns。
- [x] spawn 前确定失败可重试；spawn/写入后未确认 init、取消或超时进入 `result_unknown`，刷新/重启
  不自动重发消息或再次 Fork。
- [x] 同一 pending 子 thread 的并发首条消息、队列发送和重复 operation 只启动一次 Provider；
  新 session 建立后后续消息只 resume 新 session。
- [x] 旧 Claude CLI 禁用入口；运行中、人工输入中、缺 session 的源 thread 仍禁用；Codex Fork、普通
  Claude 热会话、Compact、审批、用户输入和附件行为无回归。
- [ ] 定向前端/Rust 测试、typecheck、build、Rust 全量、fmt、diff check 以及真实 Claude 首条消息
  Fork 验收通过；桌面顶部和右键两个入口均完成手工验收。

## Implementation Plan (2026-08-03 revision)

### Task 5.1: Pending operation and local child transaction

Files: `src-tauri/src/backend.rs` and its existing `thread_fork` tests.

- [x] Add RED endpoint tests proving Claude `/fork` creates exactly one child with null Provider session,
  stores `awaiting_first_message`, inherits trusted metadata, changes selection atomically, and never calls the
  Claude test driver; duplicate operation/source requests return the same child.
- [x] Run the focused tests and confirm the current eager Provider launch fails those assertions.
- [x] Add the minimal operation status/parser/schema compatibility and local-child transaction; keep Codex
  `provider_pending` behavior unchanged.
- [x] Re-run focused Claude and Codex Fork tests until GREEN.

### Task 5.2: Independent history snapshot copy

Files: `src-tauri/src/backend.rs`, `src/types.ts`, `src/lib/thread-fork.ts`,
`src/lib/thread-fork.test.ts`, `src/hooks/useWorkspaceState.ts` and its history tests.

- [x] Add RED backend tests proving `/fork` atomically copies the source's current visible history into the child,
  including text/thinking/tools/attachments/content blocks, and returns `historyState=loaded`.
- [x] Prove source history changes after copy do not affect the child and child history changes do not affect the
  source; duplicate operation/source requests reuse one copied child without duplicating rows.
- [x] Implement snapshot copying through the existing normalized history writer inside the child creation
  transaction; do not add history projection, `forkState` serialization or frontend source-timeline cloning.
- [x] Re-run backend history, frontend Fork and workspace history tests until GREEN.

### Task 5.3: First real message native Fork and init binding

Files: `src-tauri/src/backend.rs`, `src/hooks/useClaudeRun.ts`, existing Claude run/Fork argument tests.

- [x] Add RED tests proving only an `awaiting_first_message` child receives trusted
  `--resume <source> --fork-session`; the exact text/image/attachment content blocks are written once, while
  ordinary/new/resumed Claude runs never receive `--fork-session`.
- [x] Add RED process/runtime tests for `system/init`: reject empty/source IDs, atomically bind a distinct child
  session/transcript and operation state, preserve source runtime, then use the child session for later messages.
- [x] Implement the minimal trusted pending-operation lookup, first-run argument override and init persistence;
  do not route the delayed Fork through the old zero-prompt `create_session_fork` bridge.
- [x] Re-run `claude_run_args`, content-block/attachment, runtime and thread Fork tests until GREEN.

### Task 5.4: Single-flight, cancellation and transcript reconciliation

Files: `src-tauri/src/backend.rs` and focused Rust tests; only extend `src-tauri/src/claude_session_fork.rs`
if a reusable parser/lifecycle primitive is actually needed.

- [x] Add stable RED tests for concurrent first sends, queued send isolation, spawn-before-write failure,
  cancellation/write/EOF before init, init-then-result failure, restart recovery and repeated history reads.
- [x] Implement state transitions so pre-spawn failure remains retryable, possible Provider execution becomes
  `result_unknown`, confirmed init never reruns Fork, and transcript import deduplicates source/current turns.
- [x] Verify source/child messages, tool calls, runtime, approvals, content blocks and transcript mappings remain
  isolated across completion and restart.
- [x] Run focused tests plus the full Rust library suite until GREEN.

### Task 5.5: UI regression and real acceptance

Files: `src/types.ts`, `src/hooks/useWorkspaceState.ts`, existing `ChatHeader`/`SidebarProjects` consumers,
`src/lib/thread-fork-ui.test.ts`; no new menu or page.

- [x] Verify both existing entries open the loaded child, inherited history renders immediately, internal Fork state
  is not exposed to the UI and no layout/state regression is introduced.
- [x] Keep the child on the ordinary conversation UI; no explanatory modal, third menu, duplicated card or
  client-side full-history copy.
- [x] Run frontend Fork tests, workspace/history tests, `npm run typecheck`, `npm run build`, Rust focused/full
  suites, `cargo fmt --check` and `git diff --check`.
- [ ] On an isolated data directory, verify with real Claude 2.1.220: click creates no transcript/session; first
  real message creates one distinct native session; inherited history is visible before send; transcript/history
  remain correct after completion and restart. Then manually verify the desktop top and context-menu entries.

## Verification Commands

- `npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_fork`
- `cargo test --manifest-path src-tauri/Cargo.toml thread_fork`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_run_args`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_delayed_fork`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- 桌面验收：顶部菜单和侧边栏右键点击后均立即打开 pending 子聊天并显示源历史，且不创建 Claude
  session；发送第一条真实消息后确认只创建一个不同的新 session，完成后验证独立续聊和重启恢复；
  运行中与旧 CLI fixture 验证禁用提示。

## Implementation Record

- 2026-08-03T08:01:34.266Z 用户要求打包当前 Windows 工作区；package:doctor 已通过，开始执行 package:win，并将在完成后校验安装版、portable 与 updater 产物。
- 2026-08-03T07:58:44.627Z 已实现 Claude 自定义渠道 settings 文件化：按非敏感内容哈希写入 app_data/agent-runtimes/claude/<channel>/settings-<hash>.json，运行参数只传文件路径；API Key 仍仅经环境变量/apiKeyHelper 注入，删除渠道同步清理隔离目录。已补文件内容、密钥脱敏、参数路径和删除清理测试。

- 2026-08-03T07:50:11.276Z 真实 DeepSeek 渠道验收发现 Windows claude.cmd 会破坏内联 --settings JSON，引发 Settings file not found 后 exit 1；作为普通 Claude 渠道回归纳入 Task 5.5 收口。决定改为无密钥隔离 settings 文件路径，并补 Windows 包装入口回归测试。
- 2026-08-03T04:26:09.986Z 小范围 UI 修正：统一侧边栏右键和顶部会话操作菜单宽度为 184px，完整展示“在新聊天中继续”；新增 thread-fork-ui CSS 回归断言。桌面 HMR 实测两个入口文字完整、图标和其他菜单项未挤压。

- 2026-08-03T04:18:43.466Z 按用户确认的简单复制语义收尾：正式构建不再编译旧版点击即 eager Fork 的启动、取消和无 prompt 协议桥，仅保留为历史回归测试；生产路径只保留点击时独立快照复制、能力探测和首条真实消息延迟 --fork-session。cargo check 后旧路径的 28 组未使用警告已清除。
- 2026-08-03T04:05:12.222Z 补充协议乱序收口：真实子进程若返回 result 但从未先返回 system/init，不再映射 done 或信任 result.session_id；operation 原子进入 result_unknown、流发送明确 error 并关闭 runtime。新增真实进程回归后 claude_delayed_fork 11/11。

- 2026-08-03T03:55:31.743Z Task 5.3/5.4 收口：延迟 Claude Fork 首发使用 claim RAII 守卫区分 spawn 前可重试与 spawn 后 result_unknown；运行时创建返回 before/after-spawn 分类并禁止待 Fork 子聊天复用既存 runtime；EOF 无 init 发送 error 而非 done；init 后退出失败保留 child session。新增 Windows 真实 PowerShell 子进程测试覆盖 init 成功、EOF、init 后失败、并发首发单进程。修复子 transcript 刷新覆盖固定历史：按 operation 点击边界保留源快照，只合并边界后的 child transcript，重复读取不重复。官方文档确认 --fork-session 仅在 resume/continue 启动时创建新 session；零输入点击时 checkpoint 仍非 CLI 能力。
- 2026-08-03T02:43:11.302Z Task 5.2 完成：Claude /fork 在创建子聊天事务内通过标准化历史写入链复制固定 messages/tool_calls 快照，响应直接 historyState=loaded；复制后源与子历史互不影响，重复请求复用同一子聊天且不重复写入；未暴露 forkState，未启动 Claude Provider。

- 2026-08-03T02:33:02.858Z 2026-08-03 用户将 Claude 在新聊天中继续收敛为一次性独立快照复制：点击时原子复制当前可见历史和可信配置，之后不再同步源聊天；前端按 loaded 普通历史接入，不暴露 forkState。Claude CLI 无 prompt 不能物化 session，首条真实消息仍使用可信源 session 执行一次 --resume + --fork-session，绑定后完全独立。
- 2026-08-03T01:57:51.406Z Task 5.1 完成：Claude /fork 改为单事务创建 awaiting_first_message 本地子聊天，不启动 CLI；新增旧 SQLite CHECK/唯一索引兼容迁移、可信 channel fingerprint 继承、同 operation/同源/并发及源忙后幂等复用。主 Agent 发现并修复 result_unknown 500 与忙状态重试 409；CC max 只读复核 APPROVED。Codex eager Fork 保持不变。

- 2026-08-03T01:12:21.937Z 2026-08-03 用户确认方案 A，并补充确认 pending 子聊天立即显示源历史。设计已更新为：点击只创建 awaiting_first_message 本地子 thread；历史由后端基于 operation 只读投影，pending 期间源消息继续进入投影，Fork 上下文切点为子聊天第一条真实消息；该消息唯一一次通过 --resume 源 session + --fork-session 发送，init 后绑定新 session/transcript。明确 pre-spawn 可重试、写入后未确认 init 转 result_unknown、禁止隐藏 prompt/自动重发，并形成 Task 5.1-5.5 TDD 实施计划。
- 2026-08-02T18:54:42.682Z Task 5 真实 Claude 2.1.220 验收确认阻塞：capability 虽为 supported，但当前无 prompt 的 stream-json Fork 保持 stdin 打开时 10 秒内无 system/init；stdin 立即 EOF 则 exit 0、无输出、无新 transcript。主 Agent独立核验后交回同一 CC(max) 复查；CC 的永久 RED ignored test 因双分支恒定 panic、参数不匹配真实线程被主 Agent拒绝并已清除。官方 Agent SDK query 的 prompt 为必填，真实正对照只有发送 hi 后才生成独立 session d139b98e-2b3e-4e90-89c6-db671d2a50a4 与 transcript，因此当前 点击即原生 Fork、无 prompt、无模型生成在 CLI 2.1.220 下无受支持协议。生产代码未改，Task 5 暂不完成；待用户在延迟到首条真实消息 Fork、暂时禁用 Claude Fork、等待上游协议三个方案中确认。

- 2026-08-02T18:14:53.500Z Task 4 质量审查 APPROVED，无 P0-P2。主 Agent确认并修复唯一立即处理的 P3 恒真测试断言；固定 sleep 理论 flake、真实进程取消时 stderr drain 低概率残留、Drop 同步 fail-closed 等保留为非阻塞后续/实机风险，不扩大 Task 4 范围。
- 2026-08-02T18:00:53.215Z Task 4 规格审查闭环：CC 规格 reviewer 的 P2 stale provider_pending 竞态经主 Agent 稳定 RED 复现（DB 已 ResultUnknown 仍启动并返回 OK），交回实现 Agent增加 acquire 后数据库重读与状态分流；主 Agent复验 stale unknown/succeeded/completed 与 352 项全库通过，规格复审 APPROVED，无 P0-P2。

- 2026-08-02T17:36:48.288Z Task 4 主 Agent 独立核验并修复两项真实幂等问题：并发相同 operationId 曾双开 Claude Fork（RED create_count 2/1）；请求取消曾保留 provider_pending 并可再次启动（RED ProviderPending/ResultUnknown）。均交回同一 CC Agent 修复为源 thread 单飞 guard 与取消条件落库 result_unknown。
- 2026-08-02T17:00:12.520Z 开始 Task 4：由 CC(max) 按 TDD 实现 Claude Fork 创建、原子本地绑定和 transcript pending 恢复；CC 结论仅作线索，主 Agent 将独立复核。

- 2026-08-02T16:48:18.053Z Task 3 双审与返工闭环完成：规格审查无偏差；本地质量审查提出的完整身份探测有界性 P2 经主 Agent 独立复现确认后，交回同一质量 Agent TDD 修复。command-group 管理 Windows Job Object 与 Unix process group，超时后有界回收整组；Unix PATH 解析不再调用外部 which。主 Agent 进程级复验第 4 秒无 PING.EXE 后代。CC 额度仍在 429 窗口，本轮返工不归因于 CC。

- 2026-08-02T15:29:44.547Z Task 3 返工完成：Claude capability 命令身份解析改为 spawn_blocking，版本读取复用 read_cli_version 的 3 秒强制超时并解析语义版本；删除无界同步 Command::output。挂起版本命令回归测试在旧实现超过 5 秒失败，新实现 5 秒内返回。Claude 额度 429 导致原 cc coder 中断，由现有本地子 Agent按同一 RED 证据完成最小修复，主 Agent独立验收。
- 2026-08-02T15:27:23.501Z Task 3 返工自审收紧：read_cli_version 有界返回后继续复用 parse_claude_cli_version，保持旧 cache key 的语义版本归一化不变；重新运行单项与全部指定回归、fmt、diff 均通过。

- 2026-08-02T15:23:12.970Z Task 3 返工 GREEN：删除重复无界 read_claude_cli_version；claude_fork_probe_identity 改为 async，并在 tokio::task::spawn_blocking 内完成 resolve_claude_command + read_cli_version（3 秒有界）；JoinError 映射为固定 AgentThreadForkError::Internal 文案，不暴露命令或 stderr。单项挂起命令测试 1 passed / 0 failed，行为耗时约 3.01 秒；cache key、refresh、Provider dispatch 与 runtime gate 未改。
- 2026-08-02T15:19:00.537Z Task 3 返工有效 RED：将挂起版本命令改为约 8 秒，并通过真实 probe_claude_thread_fork_capability async 路径直接计时（无后台测试线程）。旧同步 identity 实测 8.0978565 秒，单项 0 passed / 1 failed，因超过 5 秒阈值失败，确认挂起 claude --version 会阻塞 capability handler。

- 2026-08-02T15:11:07.719Z Task 3 返工 RED（有界身份探测）：新增 hanging_version_command（Windows .cmd 用 ping、Unix sh 用 sleep，忽略 --version 长挂起）与定向测 claude_fork_capability_version_probe_is_bounded_against_hanging_command。旧 read_claude_cli_version 用同步无界 Command::output()，且 claude_fork_probe_identity 在 async capability handler 读取 cache 前直接同步调用；挂起的 claude --version/包装器会长期阻塞 Tokio worker。实测旧码：测试 0 passed / 1 failed（1.51s 触发断言——std::thread 跑 read_claude_cli_version 在 1.5s 内未返回，recv_timeout Err），证明旧代码超过有界时限/阻塞。
- 2026-08-02T15:00:16.928Z 主 Agent 独立审查 e432332 确认 Task 3 问题：backend.rs 新增 read_claude_cli_version 使用同步无界 Command::output，并由 async capability handler 在缓存读取前直接调用；若 claude --version 包装器卡住，会长期阻塞 Tokio worker。仓库已有 read_cli_version + command_output_with_timeout(3s) 可复用。交回原 cc coder 以挂起命令 RED 测试后最小修复：spawn_blocking 解析命令身份并复用有界版本读取。

- 2026-08-02T14:56:23.064Z Task 3 RED 切片二（运行态门禁）：新增 ensure_claude_thread_fork_idle 单测（active runtime current_run_id / 未 finished ActiveRunRecord / pending context request 各自拒绝，idle 通过）与端点集成测（busy Claude /fork→409、无 operation row、源 runtime 不变）。cargo test thread_fork 实测编译失败 error[E0432] unresolved import super::ensure_claude_thread_fork_idle（helper 尚不存在）。GREEN：实现只读 ensure_claude_thread_fork_idle（runtimes.current_run_id / runs 未 finished / context_requests 三态任一即 conflict），并在 fork_thread 写 prepare_thread_fork_operation 前仅对 Claude 调用；冲突直接返回不创建 operation 记录、不触碰源 runtime，Codex 路径不变。Claude /fork 当前返回占位 conflict（Task 4 替换为真实创建）。
- 2026-08-02T14:50:20.530Z Task 3 GREEN 切片一：新增 provider_supports_native_thread_fork / thread_fork_provider_label，read_fork_source_thread 与 prepare_thread_fork_operation 改用共享谓词，错误文案改为 Provider 中性（label 化）。路由 handler 更名为 thread_fork_capability / fork_thread（URL 与响应 wire shape 不变）。capability 按 source.provider 分流：Codex 继续 probe_thread_fork_capability，Claude 由后端 resolve_claude_command 后调用 claude_session_fork::probe_fork_session，未安装→error、旧 CLI→unsupported 升级提示、探测失败→error，全部不泄露命令参数/env。Claude capability 按 command path + 报告版本缓存 60s，refresh 绕过；缓存与 compute/read/write 全部留在 backend.rs（AppState 新增 claude_fork_capability_cache 字段）。cargo test thread_fork 实测 14 passed / 0 failed（RED 的两测转绿，新增缓存测验证缓存命中/refresh 绕过/identity 变更失效）。Codex 创建路径未改动。

- 2026-08-02T14:46:32.362Z Task 3 RED 切片一（可信 Provider 接受 + 能力分流）：扩展 fork_operation_source_with_provider / fork_api_fixture_with_provider 与 ThreadForkTestDriver 的 Claude capability 字段后，新增 thread_fork_prepare_accepts_native_fork_providers、thread_fork_prepare_rejects_non_native_provider、thread_fork_capability_dispatches_claude_from_source_provider，并补齐 ThreadForkRequest 伪造 provider/sessionId/workingDirectory 断言。cargo test thread_fork 实测 11 passed / 2 failed：claude-code 源在 prepare_thread_fork_operation 被拒（400 只有已建立 Provider 会话的 OpenAI Codex 聊天支持 Fork），Claude capability 端点因 read_fork_source_thread 仍只放行 Codex 返回 400。Grok 拒绝与伪造字段守卫已通过。
- 2026-08-02T14:28:52.194Z Task 2 cc 质量审查实质 APPROVED。唯一 P3：stderr 多字节 UTF-8 若跨 read 分块，诊断摘要可能出现替换字符。主 Agent 复核该边界理论上真实，但仅影响失败消息内最多 512 字符的 best-effort 辅助诊断，不影响 session ID、Fork 结果、隐私或进程生命周期；按低价值细节收住，不返工，后续如统一诊断流式解码再处理。Task 2 双门禁通过。

- 2026-08-02T14:21:42.405Z Task 2 cc 规格审查 APPROVED。主 Agent 对唯一非阻塞提示（source_session_id 未 trim）复核：Claude session ID 来自结构化 provider event 并原样持久化，Fork 将由后端从数据库可信读取，客户端不可覆盖；当前真实链路无首尾空格触发路径，不作为缺陷返工。
- 2026-08-02T14:13:51.483Z fix: bound Claude fork stderr drain。确认问题：finish_stderr_summary 用 done.await 无界等待 stderr drain 任务 EOF；直接子进程返回 init 并退出后，若后代继承 stderr 管道，EOF 迟迟不来（测试中后代存活 4s），Fork API 被挂住——主 Agent RED 测试 claude_session_fork_does_not_wait_for_descendant_stderr_eof 外层 1.5s timeout FAILED（总耗时 4.10s）。最小修复：stderr_summary_task 改返回 drain JoinHandle（去掉 oneshot）；finish_stderr_summary 用 tokio::time::timeout(STDERR_DRAIN_FINISH_TIMEOUT=500ms, &mut handle) 有界等待——超时则 handle.abort() 再 await 回收（不留后台任务），自然完成则不二次 poll（修复过程中发现并修正了 JoinHandle polled after completion 双重轮询 panic：原先 timeout Ok 后又 handle.await 二次 poll）。进程存活期间 drain 仍并发持续（未退回全量缓冲/串行）。GREEN：单项红测转绿（create 在 1.5s 内返回，assert outcome.is_ok() 通过），cargo test claude_session_fork 16 passed/0 failed。wait_or_kill 与协议超时分支的 kill+wait 仅回收直接子进程、kill 后即 reap，无真实无界问题，未改。范围仅 claude_session_fork.rs + Trellis，未触碰 backend.rs/.tmp-dev/。

- 2026-08-02T14:01:05.289Z 主 Agent 独立审查 0c27d50：原 I-1/I-2/I-3 修复与 15 项测试均确认，但新增复现 finish_stderr_summary 无界等待。回归测试 claude_session_fork_does_not_wait_for_descendant_stderr_eof：直接子进程返回有效 init 后退出，后代继承 stderr 持有 4 秒；外层 1.5 秒超时，测试 FAILED，证明 Fork API 会被无关后代拖住。已保留红测，交回原 ccagent 做最小有界收尾修复。
- 2026-08-02T13:55:21.874Z Task 2 返工加固 Claude Fork 进程生命周期（review I-1/I-2/I-3 + M5）。TDD RED（against 6f6df75 旧实现）：(1) I-2 死锁——node fs.writeSync(2,100KB) 写满 stderr 管道后写 init，旧实现无并发 drain 导致子进程阻塞、init 永不写出，10s 协议超时→Uncertain，测试 FAILED in 10.04s；(2) I-1 无界等待——旧 EOF 分支 child.wait() 无界，挂起进程测试 took 10.016s FAILED（>8s 宽限）。GREEN（新实现）：cargo test claude_session_fork 15 passed/0 failed。修复：I-1 EOF/Uncertain 分支改 wait_or_kill(FORK_GRACEFUL_EXIT_TIMEOUT)；I-2 进程启动后立即并发 drain stderr（oneshot 完成信号），缓冲只保留 StderrSummary 有界摘要，满后继续 drain 不阻塞；I-3 删除永不构造的 ClaudeSessionForkError::Unsupported，probe 续用 Ok(false) 表达不支持；M5 normalize 达上限后停止存储但仍 drain。补测试：normalize_message 控制字符/空白折叠+Unicode 按 char 截断 512；probe 启动失败/不支持(node --help)/超时(1ms)；stderr 大输出后仍读到 init；Rejected/Uncertain 注释单行且≤512；挂起进程 kill+reap 计时；Unix(cfg) 关闭 stdout 后驻留被 kill。范围仅 claude_session_fork.rs，未触碰 backend.rs 与 .tmp-dev/。

- 2026-08-02T13:13:34.889Z Task 2 Claude CLI Fork Protocol Bridge 已实现：新增 claude_session_fork 模块并在 lib.rs 注册。TDD RED1：仅注册模块+测试时 cargo test claude_session_fork 报 E0432 unresolved imports (help_supports_fork_session/extract_fork_session_id)；实现纯函数后 RED2：报 unresolved import read_fork_session_id。GREEN：cargo test claude_session_fork 7 passed/0 failed。覆盖 help_supports_fork_session 精确识别 --fork-session、extract_fork_session_id 仅接受 system/init 且新 session ID 不同、read_fork_session_id 忽略非 JSON/其他事件并 EOF 无 init 为 Uncertain、probe_fork_session（--help 只读探测）、create_session_fork（tokio process + piped stdio + Windows CREATE_NO_WINDOW + 10s 协议超时 + init 后关 stdin 优先优雅退出超时才 kill + stderr 折叠控制字符/空白并截断 512）。真实进程测试用 type/cat 验证成功路径、EOF 无 init Uncertain、超时 kill Uncertain。不发送 prompt，不接 backend.rs。
- 2026-08-02T12:41:42.707Z Task 1 前端 Provider-Neutral Fork Contract 已实现：将 codex-thread-fork 源码与两份测试收口为 thread-fork；CodexThreadForkCapability 更名为 ThreadForkCapability；Claude Code 与 Codex CLI 共用 availability、capability 请求和原子响应接入，其他 Provider 明确禁用。TDD RED：定向测试 11 项中 3 项按预期失败（Claude 被拒绝、Provider 文案不一致、中性模块未接线）；GREEN：11/11 通过。

- 2026-08-02T12:20:59.195Z 完成 Claude 在新聊天中继续实施计划：五个 TDD 切片覆盖共享前端契约、Claude CLI 协议桥、可信能力分流、事务/历史恢复和真实桌面验收。
- 2026-08-02T11:12:46.236Z 完成 Claude 在新聊天中继续设计：共享现有 Fork UI/API/本地事务，Provider 层分流到 Claude 原生 --resume + --fork-session；明确无 prompt 创建、双 ID、能力降级、状态门禁、幂等恢复、安全隐私和验收边界。

- 2026-08-02T11:09:19.271Z Task created by Trellis automation.
- 2026-08-02 原设计曾确认点击时使用无 prompt 的 `--resume + --fork-session`；该假设已被
  2026-08-03 真实 CLI 验收否定，并由本文顶部的延迟 Fork 设计正式取代。

## Verification Results

- 2026-08-03T08:28:15.951Z `targeted Claude custom-channel settings tests; cargo fmt --check; git diff --check`: 3/3 targeted tests passed; Rust format and diff checks passed
- 2026-08-03T08:09:34.561Z `npm run package:doctor && npm run package:win`: 通过：package doctor OK；前端 TypeScript/Vite、Rust release、NSIS 和 MSI 全部构建成功。生成 CodeM_0.1.19_x64-setup.exe（15015596 bytes）与 CodeM_0.1.19_x64_en-US.msi（20451328 bytes）；release codem.exe 产品/文件版本均为 0.1.19。

- 2026-08-03T07:58:45.539Z `CodeM Dev /api/claude/run -> claude.cmd -> DeepSeek deepseek-v4-flash`: 通过：桌面后端自动重启后真实返回 FIXED_OK；命令行 --settings 为隔离 JSON 文件路径，不再出现 Settings file not found；文件与实际渠道密钥比对 HasSecret=False。
- 2026-08-03T07:58:45.235Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：Rust 格式检查和差异空白检查均通过，仅有仓库既有 CRLF 提示。

- 2026-08-03T07:58:44.934Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 372 个库测试 + 13 个桌面测试通过，1 个需真实 Grok 认证的测试按预期忽略，0 失败。
- 2026-08-03T07:37:34.680Z `cargo test --manifest-path src-tauri/Cargo.toml --lib; npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts; npm run typecheck; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; git diff --check`: 提交前复验通过：Rust 371 passed/0 failed/1 ignored；前端 18/18；typecheck、build、fmt、diff check 均通过。build 仅既有 chunk/dynamic import 警告。真实 Claude 首条消息端到端验收仍保留为待办，不在本次提交中虚假关闭。

- 2026-08-03T04:26:27.069Z `npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts; npm run typecheck; npm run build; git diff --check; CodeM 桌面双入口视觉验收`: 通过：18 tests/18 pass，typecheck 与 build 通过（仅既有 chunk/dynamic import 警告），diff check 通过；侧边栏右键与顶部更多菜单均完整显示“在新聊天中继续”。
- 2026-08-03T04:18:56.260Z `cargo check --manifest-path src-tauri/Cargo.toml --lib; cargo test --manifest-path src-tauri/Cargo.toml --lib; cargo fmt --manifest-path src-tauri/Cargo.toml --check; npm run typecheck; git diff --check`: 通过：正式 Rust 构建仅保留仓库既有 5 个警告；Rust 371 passed/0 failed/1 ignored；fmt、typecheck、diff check 均通过。延迟 Fork 11/11，thread_fork 40/40。真实桌面顶部/右键入口仍因 Windows 锁屏待手工验收。

- 2026-08-03T04:05:13.002Z `cargo test --manifest-path src-tauri/Cargo.toml --lib; cargo fmt --check; git diff --check`: 最终通过：371 passed，0 failed，1 ignored；fmt exit 0；diff check exit 0，仅 LF/CRLF 提示。桌面 dev 已按 Rust 改动重启，3001 health available=true；Windows 当前锁屏，顶部/右键菜单手工 UI 验收尚未执行。
- 2026-08-03T03:58:08.166Z `frontend Fork/history tests; npm run typecheck; npm run build; cargo fmt --check; git diff --check`: 全部 exit 0；生产构建仅既有 dynamic import/chunk size 警告，diff check 仅 LF/CRLF 提示。

- 2026-08-03T03:58:07.463Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 通过：370 passed，0 failed，1 ignored（需认证 Grok CLI 的既有真实 smoke）。
- 2026-08-03T03:58:06.768Z `cargo test --manifest-path src-tauri/Cargo.toml claude_delayed_fork; cargo test --manifest-path src-tauri/Cargo.toml thread_fork`: 通过：delayed Fork 10/10（含 Windows 真实进程 init/EOF/init 后失败/并发单飞、取消边界和快照 transcript 合并）；thread_fork 40/40。

- 2026-08-03T02:43:12.054Z `Task 5.2: cargo test thread_fork; frontend thread-fork/history tests; npm run typecheck`: 通过：Rust thread_fork 40/40；前端 Fork/UI/history 17/17；tsc -b exit 0。快照覆盖 text/thinking/tool/attachments/content blocks、源子双向隔离、幂等与 bootstrap 恢复。
- 2026-08-03T01:58:04.978Z `Task 5.1: cargo test thread_fork; cargo test codex_thread_fork; schema migration test; cargo fmt --check; git diff --check`: 通过：thread_fork 39/39，codex_thread_fork 11/11，旧 schema 迁移 1/1；fmt/diff exit 0。新增 RED 曾真实返回 500，GREEN 后 pending child/provider create_count=0；CC max 只读复核 APPROVED。

- 2026-08-02T18:54:54.071Z `真实 Claude 2.1.220 零输入 Fork 协议验收 + transcript 独立核验`: FAIL/BLOCKED：隔离后端真实 operation 10 秒无 init 并进入 result_unknown；直接 CLI stdin EOF 为 exit 0/无事件/无 transcript；只有真实用户 prompt 正对照产生独立 session d139b98e-2b3e-4e90-89c6-db671d2a50a4，证明当前 CLI 无零 prompt Fork 契约。git diff 在 Trellis 记录前为空，仅 .tmp-dev/ 未跟踪。
- 2026-08-02T18:15:05.274Z `Task 4 final: cargo test claude_fork/thread_fork/codex_thread_fork/claude_run_args/--lib; cargo fmt --check; git diff --check`: 通过：claude_fork 4/4，thread_fork 32/32，codex_thread_fork 11/11，claude_run_args 2/2，Rust lib 352 passed/0 failed/1 ignored；fmt/diff exit 0；规格与质量复审均 APPROVED。

- 2026-08-02T17:36:58.518Z `cargo test --manifest-path src-tauri/Cargo.toml claude_fork; thread_fork; codex_thread_fork; claude_run_args; --lib; cargo fmt --check; git diff --check`: 主 Agent 独立通过：claude_fork 4/4，thread_fork 29/29，codex_thread_fork 11/11，claude_run_args 2/2，Rust lib 349 passed/0 failed/1 ignored；并发与取消两个回归各 1/1；fmt/diff exit 0。

- 2026-08-02T16:48:44.594Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: pass: fmt/diff exit 0; main-agent final verification
- 2026-08-02T16:48:33.004Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: pass: 332 passed, 0 failed, 1 ignored; main-agent final verification

- 2026-08-02T15:29:43.883Z `cargo test --manifest-path src-tauri/Cargo.toml claude_fork_capability_version_probe_is_bounded_against_hanging_command && cargo test --manifest-path src-tauri/Cargo.toml thread_fork && cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork && cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork && cargo test --manifest-path src-tauri/Cargo.toml --lib`: 主 Agent 独立复验通过：有界身份 1/1；thread_fork 17/17；Codex 10/10；Claude bridge 16/16；全库 lib exit 0。新增 unused warning 已修正。
- 2026-08-02T15:28:47.437Z `git diff --check`: 最终复验通过：exit code 0，仅 Windows LF/CRLF 提示。

- 2026-08-02T15:28:37.479Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 最终复验通过：exit code 0。
- 2026-08-02T15:28:26.650Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 最终复验通过：16 passed / 0 failed。

- 2026-08-02T15:28:10.178Z `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork`: 最终复验通过：10 passed / 0 failed。
- 2026-08-02T15:27:56.106Z `cargo test --manifest-path src-tauri/Cargo.toml thread_fork`: 最终复验通过：17 passed / 0 failed。

- 2026-08-02T15:27:38.226Z `cargo test --manifest-path src-tauri/Cargo.toml claude_fork_capability_version_probe_is_bounded_against_hanging_command -- --nocapture`: 最终复验通过：exit code 0；单项回归保持 GREEN。
- 2026-08-02T15:24:18.840Z `git diff --check`: 通过：exit code 0；仅 Windows LF/CRLF 提示，无 whitespace error。

- 2026-08-02T15:24:07.560Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：exit code 0。
- 2026-08-02T15:23:57.414Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 通过：16 passed / 0 failed，Claude Fork 协议桥无回归。

- 2026-08-02T15:23:46.405Z `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork`: 通过：10 passed / 0 failed，Codex Fork 路径无回归。
- 2026-08-02T15:23:36.505Z `cargo test --manifest-path src-tauri/Cargo.toml thread_fork`: 通过：17 passed / 0 failed。

- 2026-08-02T15:23:27.848Z `cargo test --manifest-path src-tauri/Cargo.toml claude_fork_capability_version_probe_is_bounded_against_hanging_command -- --nocapture`: 通过：1 passed / 0 failed；挂起约 8 秒的版本命令在既有 3 秒 timeout 后返回，实测约 3.01 秒，小于 5 秒阈值。
- 2026-08-02T14:56:31.580Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 328 passed / 0 failed / 1 ignored（AppState 新增 claude_fork_capability_cache 字段无跨模块回归）

- 2026-08-02T14:56:31.109Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: fmt --check exit 0；git diff --check exit 0（仅 LF→CRLF 归一化提示，非内容错误）
- 2026-08-02T14:56:24.516Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 16 passed / 0 failed（Task 2 协议桥未触碰）

- 2026-08-02T14:56:24.001Z `cargo test --manifest-path src-tauri/Cargo.toml codex_thread_fork`: 10 passed / 0 failed（Codex Fork 路径无回归）
- 2026-08-02T14:56:23.536Z `cargo test --manifest-path src-tauri/Cargo.toml thread_fork`: 17 passed / 0 failed（含 4 切片一 + 3 切片二新增；原 10 全绿）

- 2026-08-02T14:15:50.901Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check HEAD^ HEAD`: 主 Agent 独立复验通过：16 passed/0 failed；fmt exit 0；diff-check exit 0。仅现有 dead_code warnings，.tmp-dev 未触碰。
- 2026-08-02T14:15:50.214Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork_does_not_wait_for_descendant_stderr_eof -- --nocapture`: 主 Agent 独立复验通过：1 passed/0 failed；有效 init + 后代持有 stderr 场景不再让 Fork API 超时。

- 2026-08-02T14:14:00.620Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：fmt --check exit 0；git diff --check exit 0（仅 LF→CRLF）。范围仅 claude_session_fork.rs + Trellis 记录。
- 2026-08-02T14:14:00.157Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 通过：lib unittests 16 passed / 0 failed（含主 Agent RED 测试 claude_session_fork_does_not_wait_for_descendant_stderr_eof 转绿；finish_stderr_summary 有界 500ms+abort 回收，无双重 poll）。

- 2026-08-02T13:55:28.723Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：fmt --check exit 0；git diff --check exit 0（仅 LF→CRLF 提示）。范围仅 claude_session_fork.rs，未触碰 backend.rs / .tmp-dev/。
- 2026-08-02T13:55:28.252Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 通过：lib unittests 15 passed / 0 failed（post-fmt）。覆盖 normalize 控制字符/空白/Unicode 截断 512、probe 启动失败/不支持/超时、stderr 大输出后读到 init、Rejected/Uncertain 单行有界注释、挂起进程 kill+reap 计时、type/cat 成功与 EOF、ping/sleep 超时。

- 2026-08-02T13:13:50.769Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：cargo fmt --check exit 0；git diff --check exit 0（仅 LF→CRLF 行尾归一化提示，非内容错误）。范围仅 lib.rs 与 claude_session_fork.rs，未触碰 backend.rs 与 .tmp-dev/。
- 2026-08-02T13:13:50.327Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 通过：lib unittests 7 passed / 0 failed（含 help 精确识别、init session ID 校验、async reader 忽略非 init、EOF 无 init Uncertain、真实进程成功返回 child-session、EOF Uncertain、超时 kill Uncertain）。

- 2026-08-02T12:41:42.739Z `npm run typecheck`: 通过：tsc -b exit code 0。
- 2026-08-02T12:41:42.709Z `npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts`: 通过：11 tests，11 pass，0 fail；覆盖双 Provider availability、状态门禁、Provider 文案、响应 ID、history loaded/pending、debug/raw 隔离、capability key 全字段及双 UI 入口。

## Completion Summary

- 2026-08-03T08:28:16.635Z 完成 Claude 会话复制、首条消息延迟 Fork、自定义渠道 settings 文件化、真实 DeepSeek 验收与 Windows 打包验证

## Follow-ups

- Claude checkpoint / rewind、后台 Agent 管理和 Hooks 可观察性按独立任务设计，不混入本次 Fork。
- 完成 Claude Fork 后，再按同一证据标准审计 Grok、OpenCode 和 Pi 的高价值能力缺口。
