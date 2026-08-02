# Task: Codex 在新聊天中继续

## Background

CodeM 已接入 Codex App Server 的基础会话运行、`turn/steer` 和原生
`thread/compact/start`，但当前只能创建空白聊天，不能像官方 Codex 一样把现有会话完整
Fork 到一个独立的新聊天。用户已确认第一阶段只对齐官方“在新聊天中继续”语义，不扩展为
指定历史消息分支或其他 Provider 的模拟复制。

官方 App Server 的 `thread/fork` 会复制服务端已保存历史并返回新的 thread ID；省略
`lastTurnId` 时复制完整历史，并为新 thread 发送 `thread/started`。本功能必须以该原生历史为
唯一来源，不能通过复制 CodeM 本地消息或生成摘要伪造 Fork。

## Objective

对齐官方 Codex thread/fork，支持从当前完整会话创建独立新聊天

## Confirmed Interaction

- 在当前聊天顶部更多菜单和侧边栏聊天右键菜单中提供“在新聊天中继续”。
- 只在 Codex 聊天已具有有效 `sessionId`，且当前没有运行、审批、用户输入请求或 Compact
  操作时允许执行；不满足条件时禁用并给出具体原因。
- 操作期间只禁用当前源聊天的重复 Fork 动作，并显示非阻塞进度；原聊天内容和状态保持不变。
- 成功后立即把新聊天加入同一项目并打开；本地与 Codex 都使用新的 thread ID。
- 新聊天继承源聊天的标题、项目、工作目录、Provider、模型、reasoning effort、权限模式和渠道；
  后续仍可使用现有重命名和自动命名能力。
- 新聊天不继承运行状态、待发送队列、审批、用户输入请求、Compact 状态、调试事件或 raw events。

## Protocol Semantics

- 通过源 Codex runtime 调用 `thread/fork`，请求只传源 `threadId`，不传 `lastTurnId`，也不传
  `ephemeral`。
- 以响应中的新 `thread.id` 为新聊天的 Provider thread ID，并校验它非空且不等于源 ID。
- `thread/started` 是同一操作的生命周期通知，不得据此重复创建本地聊天；请求 ID 与通知只用于
  关联和诊断。
- 新聊天的历史从 Fork 响应或后续 `thread/read` / `thread/resume` 的原生历史归一化得到；禁止
  直接复制源聊天的本地 `conversation_turn`、message、debug 或 raw 记录。
- 若当前 Codex CLI 不支持 `thread/fork`，该动作禁用并提示升级；不提供摘要续聊、本地消息复制
  或普通新聊天等静默回退。

## Architecture And Data Flow

1. 前端动作提交源 CodeM thread ID，不允许前端直接提供或覆盖 Provider thread ID、项目、权限等
   继承字段。
2. 后端读取源 thread，校验 Provider、`sessionId`、项目归属和互斥状态，再从受信任的本地记录
   生成继承配置快照。校验通过后先写入不可见的最小 Fork 操作记录；该记录失败时不得调用 Provider。
3. 后端通过源 thread 的 Codex runtime actor 发起 `thread/fork`。Fork 期间 source runtime 继续
   负责协议请求关联，但返回的新 Provider thread 不复用源 actor 的运行状态。
4. Provider 成功后先把新 Provider thread ID 写入操作记录，再在一个本地事务中创建新的 CodeM
   thread ID、绑定新的 Codex thread ID、写入继承配置并建立 Fork 来源关联。新 thread 首次运行时
   使用自己的 runtime actor。
5. 后端读取并归一化新 Provider thread 的完整已保存历史，再返回可直接加入工作区状态的
   `ThreadDetail`；前端只消费后端结果并激活新聊天。
6. 原 CodeM thread、原 Codex thread、本地历史、队列和运行句柄均不修改。

建议新增单一后端编排端点，例如
`POST /api/projects/{project_id}/threads/{thread_id}/fork`。具体路径可遵循现有 router 命名调整，
但 Provider Fork 与本地 thread 创建必须由同一后端流程编排，不能由前端串联两个请求。

## Failure And Recovery

- 校验失败或 Provider 失败：不创建可见的新 CodeM thread，原聊天不变，显示可重试错误。
- 超时或响应不确定：禁止自动重试，避免重复创建多个 Provider thread；标记为“结果未知”，通过
  `thread/list` / `thread/read` 按 `forkedFromId`、操作时间窗口和已知请求关联执行只读核对。只有
  唯一匹配时才继续本地绑定；零匹配或多匹配时保持待人工重试状态，不猜测归属。
- 应用重启时遗留的 Provider 请求中状态同样视为“结果未知”，只能先执行只读核对，不能因为本地尚未
  记录返回 ID 就再次调用 `thread/fork`。`thread/list` 的 `parentThreadId` 属于实验筛选字段，恢复逻辑
  使用稳定分页字段并在本地按 `forkedFromId` 和时间窗口过滤，不要求启用 `experimentalApi`。
- Provider 成功、本地事务失败：持久化一条最小 Fork 恢复记录，至少包含操作 ID、源 CodeM
  thread ID、新 Provider thread ID、时间和状态，不保存消息正文、raw RPC 或环境变量。用户重试时
  复用该 Provider thread 完成本地绑定，不能再次调用 `thread/fork`。
- 新 Provider 历史读取失败但本地绑定成功：保留新聊天和双 ID 映射，显示可恢复错误；后续只读
  `thread/read` / `thread/resume` 重建显示历史，不回退为复制源本地历史。
- 前端加入状态或切换失败：刷新工作区后应能从本地持久化记录发现新聊天，不重复 Fork。
- 恢复记录的具体落库形式在实施前核对现有 SQLite 迁移策略；无论采用独立操作表还是等价的
  provisioning 状态，都必须支持应用重启后的幂等恢复。

## Security, Privacy And Compatibility

- 后端只接受源 CodeM thread ID，所有 Provider 身份和继承配置从数据库读取，防止跨项目或伪造
  Provider thread ID。
- Fork 只复制 Codex 已保存的会话历史；不额外读取工作区文件，不扩大原会话权限，也不自动发送
  新 turn。
- 恢复与诊断只保存有限元数据，不保存完整 JSON-RPC、消息正文、附件内容、环境变量或审批参数。
- 功能只影响 Codex；Claude Code、Grok、OpenCode、Pi 的新建聊天和现有会话菜单行为保持不变。
- 能力判断按当前 Codex runtime 进程生效；method not found 后在该进程内禁用，runtime 或 CLI
  更新后重新探测。
- 本功能不改变现有 CodeM thread ID 与 `sessionId` 的双 ID 约束。

## Scope

In scope:

- Codex 完整已保存会话的原生 `thread/fork`。
- 顶部聊天菜单和侧边栏右键菜单入口、禁用原因、进行中和错误反馈。
- 新 CodeM thread 的原子创建、Provider ID 绑定、配置继承、历史归一化和立即打开。
- Provider 成功但本地失败、结果未知和历史读取失败的幂等恢复。
- 协议、后端事务、前端状态和真实桌面流程的回归测试。

Out of scope:

- 传 `lastTurnId` 的指定历史轮次 Fork，或在单条消息菜单中创建分支。
- 运行中、审批中、等待用户输入或 Compact 中的会话 Fork。
- 跨项目 Fork、改变工作目录后 Fork、选择性继承设置。
- Claude Code、Grok、OpenCode、Pi 的本地复制、摘要续聊或伪 Fork。
- Fork 后自动发送消息、自动改写标题、合并分支、回滚或删除原聊天。
- 直接复制 CodeM 本地消息、附件、队列、审批、debug/raw 事件。

## Impact

- `src-tauri/src/codex_app_server.rs`：`thread/fork` 请求、响应、通知关联和协议测试。
- `src-tauri/src/agent_run.rs`：源 runtime Fork 控制命令、互斥状态和 capability 暴露。
- `src-tauri/src/backend.rs`：Fork 编排端点、本地事务、历史归一化、恢复状态及持久化测试。
- `src/hooks/useWorkspaceState.ts`：调用 Fork API、原子加入工作区并激活新聊天、刷新恢复。
- `src/components/ChatHeader.tsx`、`src/components/SidebarProjects.tsx`：菜单动作、禁用原因和进度反馈。
- `src/types.ts` 及相关 API helper：Fork 请求、结果、状态和 capability 类型。

实施时应先用 `rg` 重新确认实际所有权；以上是设计影响面，不授权无关重构。

## Acceptance Criteria

- [ ] Codex 空闲会话可从两个既有菜单执行“在新聊天中继续”，成功后立即打开新聊天。
- [ ] `thread/fork` 请求省略 `lastTurnId` 和 `ephemeral`，新 Provider thread ID 与源 ID 不同。
- [ ] 新 CodeM thread ID 与源 ID 不同，绑定返回的 Provider thread ID，且原、新两组 ID 不错绑。
- [ ] 新聊天完整显示 Provider Fork 的已保存历史，原聊天保持不变；实现未复制源本地消息记录。
- [ ] 项目、工作目录、Provider、模型、reasoning effort、权限、渠道和标题按设计继承。
- [ ] 队列、运行状态、审批、用户输入请求、Compact 状态、debug/raw events 均未继承。
- [ ] 运行中、审批中、等待用户输入、Compact 中、无 sessionId、非 Codex 或能力不支持时不能误发
  Fork，并能看到准确原因。
- [ ] Provider 失败不产生本地残留；结果未知不自动重试；Provider 成功而本地失败可在重启后幂等恢复，
  且不会创建第二个 Provider Fork。
- [ ] 历史读取失败可通过原生只读恢复，不降级为本地消息复制。
- [ ] Claude Code、Grok、OpenCode、Pi 的新建聊天、菜单和运行流程无回归。
- [ ] 长会话 Fork 不导致源会话整树重渲染或同步挂载全部历史；新聊天沿用现有分页/增量渲染边界。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml codex`
- `cargo test --manifest-path src-tauri/Cargo.toml fork`
- `$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' }); node --import tsx --test $testFiles`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

定向自动化至少覆盖：请求参数不含 `lastTurnId`、双 ID 唯一性、继承字段、运行互斥、
method-not-found、Provider 失败、本地事务失败、结果未知防重复、重启恢复、历史读取重试、其他
Provider 回归和长历史增量装载。

真实桌面验收至少覆盖：

1. 在支持 `thread/fork` 的 Codex 完整会话中，从顶部菜单执行并核对新旧聊天历史和 ID。
2. 从侧边栏右键执行同一路径，确认成功后定位到新聊天且原聊天不变。
3. 分别在生成中、审批中和 Compact 中检查禁用状态，不产生 Provider 请求。
4. 使用 method-not-found fixture 或不支持版本检查升级提示，确认没有本地复制或摘要回退。
5. Fork 长会话后切换、刷新和重启应用，确认新聊天可恢复、历史不重复、控制台无错误。

## Implementation Record

- 2026-08-02T07:19:33.652Z Task 2 GREEN：Fork 定向测试 9 passed；完整 agent_run::tests 69 passed；cargo fmt --check 通过。Fork 经源 runtime actor 串行，使用 fork:<operationId> 互斥，不创建 run record/聊天终态事件；超时与通道未知映射 Uncertain，历史读取失败保留 ProviderCreated。
- 2026-08-02T07:10:19.093Z Task 2 第二轮 RED：Fork 定向测试按预期因 complete_fork_command/fail_fork_command 尚不存在而失败；该缺口对应 Actor 完成与启动/关闭错误必须统一结束 oneshot、且不得写普通聊天事件的契约。

- 2026-08-02T07:03:35.395Z Task 2 RED：cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests::fork -- --nocapture 按预期失败；缺少 AgentRuntimeCommand::Fork、dispatch_fork、Fork capability cache 与 Fork DTO/错误分类，确认测试命中新功能缺口。
- 2026-08-02T05:49:00.034Z Task 1 GREEN：实现原生 thread/fork 能力探测、源运行态检查、严格仅 threadId 请求、Provider child ID 校验、完整 thread/read 快照、ForkHistory 专用错误和稳定 thread/list 本地恢复筛选；私有 reasoning、未知 item 与 base64 图片不落历史。

- 2026-08-02T05:39:05.717Z Task 1 RED：新增 Codex thread/fork 协议测试矩阵；定向 cargo test 因 CodexForkCapability、ForkHistory、fork/read/list 快照方法缺失而按预期失败。官方 App Server 文档确认完整 Fork 请求仅传 threadId，thread/read 为只读历史，parentThreadId/ancestorThreadId 仍为实验过滤字段。
- 2026-08-02T05:29:19.393Z 修正计划交接：实现阶段必须新建 Trellis session；Task 7 在 complete 前从 current-session.json 捕获实际 implementation record 路径，最终只暂存该记录，避免误写计划阶段 session。

- 2026-08-02T05:27:44.955Z 已完成 Codex 在新聊天中继续实施计划：拆分 7 个 TDD 任务，明确协议、runtime actor、SQLite 状态机、后端幂等编排、前端状态和双菜单验收；官方核对确认 parentThreadId 为实验筛选，恢复改用稳定 thread/list 字段加本地过滤；本轮未修改产品代码。
- 2026-08-02T04:53:02.569Z 设计确认：第一阶段仅支持 Codex 完整已保存会话的原生 thread/fork；请求省略 lastTurnId 和 ephemeral，不复制本地消息或摘要，不支持指定轮次/跨项目/其他 Provider 伪 Fork；空闲状态才可执行，成功后创建独立双 ID 新聊天并立即打开；Provider 成功而本地失败通过预写最小操作记录和只读核对实现幂等恢复。

- 2026-08-02T04:47:35.559Z Task created by Trellis automation.

## Verification Results
- 2026-08-02T07:20:49.660Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests -- --nocapture；cargo fmt --manifest-path src-tauri/Cargo.toml -- --check；git diff --check`: 69 passed，格式与 diff 检查通过

- 2026-08-02T05:49:00.050Z `Task 1 Codex Fork 协议层`: cargo test codex_app_server::tests::fork：6 passed；cargo test public_agent_errors_keep_details_for_each_transport_error：1 passed；cargo fmt --check：通过；仅有既有 dead_code/linker warnings。
- 2026-08-02T05:29:20.062Z `实施 session 交接、动态 record 路径、占位符与 git diff --check`: pass：Execution Setup 明确新建实现 session；Task 7 在 complete 前读取 sessionPath 并用于最终 git add；占位符 0；git diff --check 通过，仅有 Windows LF/CRLF 提示。

- 2026-08-02T05:27:45.671Z `实施计划规格覆盖、占位符、类型/API/路径一致性与 git diff --check`: pass：thread/fork、双 ID、历史来源、互斥、六状态恢复、重启 unknown、双入口、非 Codex 回归和长历史均映射到 Task 1-7；占位符 0；缺失路径 0；Rust 多过滤命令已拆正；git diff --check 通过，仅有 Windows LF/CRLF 提示。
- 2026-08-02T04:54:06.040Z `设计占位符、范围一致性、影响路径与 git diff --check`: pass：无待补充/TBD/TODO/FIXME；完整会话 Fork 与指定轮次 Fork 边界明确；恢复流程先写操作记录且结果未知只读核对；7 个影响文件路径存在；git diff --check 通过，仅有既有 Windows LF/CRLF 提示。

## Completion Summary
- 2026-08-02T05:29:20.762Z 完成实施计划交接修正：实现阶段不复用已关闭的计划 session，最终 Trellis record 路径由 current-session.json 动态取得并精准暂存；未修改产品代码。

- 2026-08-02T05:27:46.445Z 完成 P0-3 Codex 在新聊天中继续的可执行实施计划与自审：共 7 个 TDD 任务，补齐官方稳定协议边界、冷/热 runtime、原子落库、重启与结果未知恢复、前端双入口及桌面验收。当前仅完成计划文档，尚未修改产品代码；等待用户选择 Subagent-Driven 或 Inline Execution 后实施。
- 2026-08-02T04:54:16.620Z 完成 P0-3 ‘在新聊天中继续’书面设计：对齐官方 thread/fork 完整历史语义，明确双入口、空闲门禁、双 ID、Provider 历史来源、配置继承、幂等恢复、安全兼容、验收与验证边界；同步标记 P0-2 Compact 已完成并后置指定轮次 Fork。当前仅完成设计，尚未生成实施计划或修改产品代码，等待用户审阅。

## Follow-ups

- 用户已确认本设计；实施计划见 `.trellis/tasks/codex-continue-in-new-chat-implementation-plan.md`。
- 计划通过书面自审和用户执行方式确认后，再按 Task 1-7 进入编码。
- 指定历史轮次 Fork 需要先稳定持久化普通 turn 的 `providerTurnId`，作为后续独立任务评估。
