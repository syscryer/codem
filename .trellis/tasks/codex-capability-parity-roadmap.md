# Task: Codex 原生能力接入路线

## Background

CodeM 已完成 Codex App Server 的基础会话运行、继续会话、中断、审批交互、文件产物和 Diff 审查映射，
但当前桥接主要使用 `thread/start|resume`、`turn/start|interrupt`。Codex CLI 已公开更多结构化能力，
CodeM 尚未消费，导致以下体验差距：

- Codex 运行中收到的新消息只能进入下一轮队列，不能像 Claude Code 一样立即引导当前轮次。
- 上下文压缩仍走 CodeM 的通用 `/compact` 兼容路径，没有使用 Codex 原生 compact 生命周期。
- 无法从指定历史轮次 Fork 新会话，也没有 Codex 原生 Archive/Unarchive 同步。
- 现有“审查全部”是本地 Diff 浏览，不是 Codex `review/start` 的独立结构化审查流程。
- Codex 的结构化计划、压缩节点和更完整执行过程被折叠为普通“思考中”，产物仍缺少搜索、导出和批注闭环。

本路线基于 Codex App Server 官方文档、本机 `codex-cli 0.146.0` 协议 schema、CodeM 当前实现，
并参考成熟开源客户端的会话与审查交互。协议能力以运行时探测结果为准，不把某个 CLI 版本写死为长期前提。

## Objective

分三个阶段接入 Codex 原生能力：

1. **P0 会话控制与分支**：先补齐运行中引导、原生压缩、历史 Fork、归档恢复。
2. **P1 审查闭环**：接入 Codex 原生 Review，并与现有右侧 Diff 工作台形成可定位、可追踪的审查流程。
3. **P2 过程与产物可观察性**：结构化呈现计划与压缩节点，补齐全文搜索、导出、批注和执行树。

本任务负责路线、边界、数据契约和验收口径；实际编码按 P0-1 至 P2 的里程碑分别续接 Trellis 记录。

## Priority And Dependencies

| 优先级 | 阶段 | 首要价值 | 前置依赖 |
| --- | --- | --- | --- |
| P0 | 会话控制与分支 | 直接改善高频会话操作，并建立后续原生能力的 thread/turn 控制通道 | 现有 Codex 常驻 runtime、sessionId 持久化 |
| P1 | 审查闭环 | 从“查看 Diff”升级到“发起审查、消费结论、定位问题” | P0 的能力探测、thread 身份同步与控制 API |
| P2 | 过程与产物可观察性 | 让长任务、计划和产物可检索、可导出、可批注 | 稳定的结构化事件模型与持久化边界 |

P0 内部固定按以下顺序推进：

1. `turn/steer`
2. `thread/compact/start`
3. `thread/fork`
4. `thread/archive` / `thread/unarchive`

原因：运行中引导使用频率最高，且可复用当前 runtime 控制通道；compact 需要先稳定 thread 事件和状态同步；
Fork 与 Archive 会创建或改变会话身份，放在前两项稳定后处理可降低历史错绑和数据丢失风险。

## Scope

### P0: 会话控制与分支

#### P0-1 运行中引导

- Codex 当前轮次已获得 `turnId` 后，允许把队首且明确选择“引导”的文本消息通过 `turn/steer` 注入当前轮次；
  请求使用该 ID 作为 `expectedTurnId`，让 App Server 拒绝注入到已经切换的轮次。
- Composer 保留“排队”和“引导”两种语义；默认行为继续使用现有队列，用户主动选择引导时才调用原生能力。
- 引导请求保留统一 `contentBlocks` 的文本语义；第一版只支持文本块。图片、上传附件、项目文件引用仍排队到下一轮，避免丢失附件语义。
- 请求成功后从队列移除并显示“已引导当前轮次”；请求失败、超时或能力不支持时，原消息保持队列状态，不静默丢弃或重复发送。
- 当前轮次尚无 `turnId`、正在处理中断/审批、runtime 已退出时，不发送 steer，继续按队列处理。

#### P0-2 原生上下文压缩（已完成）

- Codex Provider 的 `/compact` 改为调用 `thread/compact/start`；其他 Provider 保持现有逻辑。
- 压缩期间展示独立状态，禁止同一 thread 重复发起 compact；普通消息可保留队列，但不能和 compact 并发启动 turn。
- 消费 compact started/completed/failed 相关响应或通知，把压缩节点作为轻量系统事件写入历史。
- 失败不清空本地历史、不覆盖 `sessionId`；恢复普通发送前必须确认 runtime 回到可用状态。
- 自动压缩只展示 Codex 实际上报的节点，不根据 token 阈值伪造“已完成压缩”。
- 不支持原生 Compact 的 Codex 版本禁用该动作并提示升级；不发送 `/compact` 文本作为兼容回退。

#### P0-3 在新聊天中继续

- 在当前聊天顶部更多菜单和侧边栏聊天右键菜单提供“在新聊天中继续”；仅 Codex、已存在原生
  thread ID 且会话空闲时可用。
- 调用 `thread/fork` 时只传原 Codex `threadId`，省略 `lastTurnId`，复制当前完整已保存会话；
  成功后创建新的 CodeM thread，并绑定返回的新 Codex thread ID。
- 新聊天历史从 Fork 响应或原生 `thread/read` / `thread/resume` 归一化，不直接复制源聊天的本地
  message/turn 记录；继承项目、工作目录、Provider、模型、reasoning effort、权限、渠道和标题。
- 原 thread 保持不变；新 thread 具有独立 CodeM/Codex 双 ID，成功后立即打开。不继承运行状态、
  队列、审批、用户输入请求、Compact 状态、debug/raw 日志。
- 运行中、审批中、等待用户输入或 Compact 中禁用 Fork，避免复制半完成状态。
- Fork 失败不得创建可见的本地残留；Provider 成功而本地失败时保留最小恢复记录，重试只完成
  本地绑定，不再次创建 Provider Fork。
- 不支持 `thread/fork` 的 CLI 禁用动作并提示升级；不使用本地消息复制、摘要续聊、普通新聊天或
  `thread/rollback` 作为回退。
- 指定 `lastTurnId` 的历史轮次 Fork 后置为独立阶段，待普通 turn 的 `providerTurnId` 持久化稳定后再设计。

#### P0-4 Archive / Unarchive

- 归档是可恢复操作，与现有永久删除分离；侧边栏默认隐藏归档会话，设置页提供归档列表和恢复操作。
- Codex thread 调用 `thread/archive` / `thread/unarchive`，CodeM 本地记录 `archivedAt` 和同步状态。
- 先完成远端动作，再提交本地状态；失败时保持原列表位置并明确提示。
- 非 Codex Provider 先只使用本地归档语义，不能伪装为已同步原生 Provider。
- 永久删除仍走现有删除确认；已归档会话可删除，但必须明确“不可恢复”。

### P1: Codex 原生审查闭环

- 接入 `review/start`，支持四类目标：未提交修改、相对基准分支、指定 Commit、自定义审查要求。
- 支持 inline 和 detached 两种模式；第一版默认 detached，避免审查流阻塞当前对话。
- 将结构化 finding 归一化为 CodeM 审查结果：严重级别、标题、说明、文件、行号、审查目标和状态。
- 结果卡片可在聊天中展开，并直接定位现有右侧 Diff 工作台；刷新后仍可恢复审查摘要和定位信息。
- 同一目标重复审查需要可区分，记录开始时间、完成状态和目标快照，不把旧结论覆盖成新结论。
- 第二阶段后续项：逐行评论、finding 已处理状态、文件/Hunk 暂存与撤销；不与首版 Review 同批实现。

### P2: 过程与产物可观察性

- 消费 `turn/plan/updated`，显示结构化步骤、状态变化和当前步骤，不再统一降级为“思考中”。
- 显示原生上下文压缩节点，并区分用户手动压缩与 Codex 自动压缩。
- 增加会话全文搜索，覆盖用户消息、助手正文、文件名、工具摘要和审查标题；默认不索引 raw events 和敏感正文。
- 支持 Markdown 与 JSON 导出；导出包含会话元数据、正文、文件清单、审查摘要和计划节点，不包含 base64、原始协议事件、环境变量或审批敏感详情。
- 对输出文档和审查 finding 增加选区批注；批注是 CodeM 本地数据，不修改原文件，需记录目标文件/消息、稳定锚点和失效状态。
- 扩展子 Agent 执行树，呈现父子关系、状态、耗时和摘要；大树默认折叠并按需渲染。

### Out Of Scope

- 不重写 Codex CLI/App Server，不解析自然语言猜测协议状态。
- 不把 CodeM 本地 thread ID 改成 Codex thread ID，也不让多个 CodeM thread 隐式共享同一 Codex thread。
- 不在 P0 支持 steer 附件、跨项目 Fork、指定历史轮次 Fork、Fork 运行中轮次或归档正在运行的会话。
- 不在 P1 首版实现自动修复、自动提交、自动暂存或自动撤销。
- 不在 P2 首版实现 PDF/DOCX 深度解析、云端导出同步或多人实时批注。
- 不改变 Claude Code、Grok、OpenCode、Pi 的已有协议；共享 UI 能力需通过通用类型适配。

## Interaction Decisions

- 运行中消息继续先进入可见队列；Codex 支持 steer 时，队列项提供“引导当前轮次”，而不是发送即自动 steer。
- `/compact` 执行时使用会话区内状态节点，不弹出阻塞式对话框。
- “在新聊天中继续”放在当前聊天顶部更多菜单和侧边栏聊天右键菜单；新聊天是独立侧边栏会话，
  不在原会话内制造分叉视图。
- Archive 放在会话更多菜单，Unarchive 放在设置页归档列表；永久删除继续使用危险操作样式。
- Review 使用目标选择弹层，结果复用现有聊天卡片和右侧 Diff，不新建独立全屏审查页面。
- 计划、压缩和执行树是会话过程信息，默认紧凑展示；长内容折叠，避免挤压主回答。

## Data And Identity Strategy

### 双 ID 约束

- `ThreadSummary.id` / 本地 `threads.id` 始终是 CodeM thread ID，继续作为路由、SQLite 外键、UI 状态和运行队列主键。
- `ThreadSummary.sessionId` 对 Codex Provider 表示 Codex App Server `thread.id`。现阶段继续沿用字段，避免一次性迁移全部 Provider。
- 新增协议事件需要显式携带 `providerThreadId` 和必要的 `providerTurnId`，不得仅凭当前活动会话推断。
- `providerTurnId` 只保存到对应 `ConversationTurn` 的 provider metadata；不复用 CodeM 本地 `turn.id`。
  当前完整会话 Fork 不依赖它；未来指定轮次 Fork 才使用它作为 `lastTurnId`，steer 使用活动轮次 ID
  作为 `expectedTurnId`。
- Fork 成功后必须创建新的 CodeM thread ID，并把新的 Codex thread ID 写入其 `sessionId`；禁止原、新 CodeM thread 指向同一个 Codex thread。

### 同步与恢复

- 启动或 resume 成功后，以 App Server 返回的 thread ID 为准回写当前 CodeM thread；请求 ID 与返回 ID 不一致时记录有限诊断并停止危险操作。
- steer、compact、fork、archive 的后端请求都同时校验 CodeM thread、Provider、当前 runtime session 和 Codex thread ID。
- 应用重启后以本地映射恢复；执行 Provider 原生变更前先 resume/probe，不能仅凭缓存状态假定远端存在。
- 原生 thread 不存在时保留 CodeM 历史，标记 Provider 会话失联，并允许用户从现有可见历史开启新 Codex thread。

### 建议数据扩展

- `threads.archived_at`：本地归档时间。
- `threads.provider_sync_state`：`synced | pending | failed | local_only`，仅在确有同步 UI 需求时落库。
- `conversation_turn.provider_metadata`：至少容纳 `providerThreadId`、`providerTurnId`、fork 来源和 compact/review 关联 ID；优先复用现有 JSON 历史结构，避免为每个协议事件扩表。
- `codex_capabilities`：运行时内存缓存，不持久化为长期真相；记录 CLI 版本、方法支持状态和探测时间即可。

实际迁移前需先检查现有 SQLite schema 的升级策略；字段命名可在详细设计中调整，但双 ID 语义不可改变。

## Backend And Frontend Impact

| 层 | 主要文件/模块 | 计划改动 |
| --- | --- | --- |
| Codex 协议桥 | `src-tauri/src/codex_app_server.rs` | 能力探测；steer、compact、fork、archive、review 请求；turn/plan 及相关通知解析；协议级单测 |
| Agent runtime | `src-tauri/src/agent_run.rs` | 扩展 runtime control command；暴露会话控制 API；校验 active turn/session；映射通用事件 |
| 本地 API/存储 | `src-tauri/src/backend.rs` | Fork 本地事务、归档状态、历史复制边界、搜索/导出接口与迁移 |
| 通用类型 | `src/types.ts` | provider metadata、capability、plan/compact/review/fork/archive 状态类型 |
| 运行 Hook | `src/hooks/useAgentRun.ts` | Codex steer 与失败回队；会话控制状态；结构化事件消费 |
| 工作区状态 | `src/hooks/useWorkspaceState.ts` | 新 thread 原子接入、归档列表、恢复、ID 映射持久化 |
| 输入区 | `src/components/Composer.tsx` 及队列组件 | 排队/引导动作、能力不可用与处理中状态 |
| 会话与侧栏 | `src/components/ChatHeader.tsx`、`src/components/ConversationTurn.tsx`、`src/components/SidebarProjects.tsx` | 完整会话 Fork 入口、计划/压缩/审查卡片、Archive 菜单；指定轮次入口后置 |
| 设置与搜索 | `src/components/settings/SessionManagementSettings.tsx`、`src/components/SessionSearchDialog.tsx` | 归档恢复、全文搜索、导出入口 |
| Diff 工作台 | 现有 changed-files / review helper 与工作台组件 | finding 定位和审查目标快照复用，不重做 Diff 引擎 |

每个里程碑实施前用 `rg` 重新确认实际所有权；表中是影响图，不授权无关重构。

## Capability Detection And Compatibility

- 首选 App Server 初始化响应或官方能力字段；协议未直接声明时，使用只读、无副作用的探测或已知 schema/版本映射。
- 后端向前端返回按方法划分的 capability，例如 `turnSteer`、`threadCompact`、`threadFork`、
  `threadArchive`、`reviewStart`、`structuredPlan`，不能只返回一个笼统 `codexEnhanced=true`。
- 未支持的方法在 UI 中隐藏或禁用并说明当前 Codex 版本不支持；普通发送、排队、本地历史和现有 Diff 不受影响。
- 遇到 JSON-RPC method not found 时，将该能力在当前 App Server 进程内熔断，不重复请求刷屏；CLI 升级或 runtime 重启后重新探测。
- 不因增强能力失败重启整个主 WebView；只重建受影响的 Codex runtime，且保留 CodeM 历史与未发送队列。
- 兼容最低线是当前基础能力：start/resume、turn start/interrupt、审批、文件变化和历史恢复必须保持可用。

## Failure And Rollback Rules

- **Steer**：成功响应后才从队列移除；结果不确定时标为“引导状态未知”，禁止自动再发以避免重复。
- **Compact**：失败后恢复普通可发送状态；保留失败节点，不修改历史正文和 session 映射。
- **Fork**：Provider 成功、本地失败时记录受限恢复项；本地事务未提交前不出现在侧边栏。
- **Archive**：Provider 失败则本地不归档；本地落库失败则立即尝试 unarchive，若补偿失败标为同步失败。
- **Review**：失败只结束本次 review run，不影响主会话和工作区文件。
- 功能开关按单项 capability 控制，可逐项关闭增强能力而不回滚数据库或基础 Codex 运行。

## Security, Privacy And Persistence

- 不持久化 Codex 原始 JSON-RPC、环境变量、完整命令环境、审批敏感参数、base64 或附件全文。
- steer 只发送用户明确选择的队列项；不得把后续所有排队消息批量注入当前轮次。
- Fork 历史只来自 Codex 原生已保存会话并归一化到新聊天，不直接复制源 CodeM 的本地消息；
  debug/raw events、运行时句柄、队列、Compact 状态、审批和用户输入请求不得复制。
- Review 仅在用户明确发起时读取所选目标；不自动上传或审查工作区外路径。
- 导出默认进行相同脱敏；JSON 导出使用版本化 schema，避免把内部数据库记录直接序列化。
- 搜索索引遵循历史保留策略；删除会话时同步删除索引与本地批注。
- 批注锚点失效时标记为失效，不用模糊匹配把评论错误附着到其他内容。

## Milestones And Acceptance Criteria

### Planning Gate

- [x] 三个方向已写入统一路线，并明确 P0 > P1 > P2。
- [x] P0 已拆成 steer、compact、fork、archive 四个可独立验收的里程碑。
- [x] 已定义交互、数据流、双 ID、失败回滚、能力降级、安全隐私和兼容策略。
- [x] 已列出主要前后端影响面和各阶段验证方式。

### P0-1 Acceptance: turn/steer

- [x] Codex 运行中可把单条纯文本队列项引导到当前轮次，且 UI 明确区分排队与已引导。
- [x] 无 turnId、非 Codex、附件消息、能力不支持时不误发 steer。
- [x] 成功不重复执行下一轮，失败保留队列，状态未知不自动重发。
- [x] Claude Code 与其他 Provider 队列/引导行为无回归。

### P0-2 Acceptance: native compact

- [x] Codex `/compact` 调用原生协议，展示 started/completed/failed 节点并持久化。
- [x] compact 与 turn 不并发，同一 thread 不重复触发；失败后通过明确重试或跳过恢复普通发送。
- [x] 不支持原生能力的旧 CLI 禁用 Compact 并提示升级，不发送文本回退、不伪造完成状态。

### P0-3 Acceptance: fork

- [x] 可从空闲 Codex 完整会话创建独立 CodeM/Codex 新聊天，并立即打开。
- [x] 请求省略 `lastTurnId`；新聊天从 Provider Fork 历史归一化，原会话不变且不直接复制本地消息。
- [x] 项目、工作目录、Provider、模型、reasoning effort、权限、渠道和标题继承正确，运行状态、队列、
  审批、用户输入请求、Compact、raw/debug 不继承。
- [x] Provider 或本地事务失败不产生侧边栏残留；Provider 成功、本地失败和结果未知均可幂等恢复，
  不重复创建 Provider Fork。

### P0-4 Acceptance: archive

- [ ] 归档会话从默认侧边栏隐藏，可在设置页恢复，且与永久删除明确区分。
- [ ] Codex 远端与 CodeM 本地状态按补偿规则同步，失败状态可见且可重试。
- [ ] 运行中会话不可归档，非 Codex 会话使用明确的 local-only 语义。

### P1 Acceptance: review

- [ ] 四类 review target 均能启动并显示目标快照、进度、失败和完成状态。
- [ ] finding 结构化持久化并可准确打开对应文件和行号 Diff。
- [ ] detached review 不阻塞主会话；刷新后结果仍可恢复且多次审查不互相覆盖。
- [ ] 不自动修改、暂存、撤销或提交用户文件。

### P2 Acceptance: observability

- [ ] 原生 plan 与 compact 节点结构化显示并随事件增量更新，大内容默认折叠。
- [ ] 全文搜索可以命中规定字段，不索引敏感原始事件。
- [ ] Markdown/JSON 导出经过脱敏，JSON schema 有版本号，导入范围不在本期。
- [ ] 批注稳定绑定或明确失效；子 Agent 大树按需渲染且长会话无明显卡顿。

## Verification Commands

所有实现里程碑的基础回归：

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml codex`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

按里程碑补充定向测试：

- P0-1：协议响应、无 turnId、失败回队、未知结果防重复、附件禁用、其他 Provider 队列回归。
- P0-2：compact 状态机、并发门禁、失败恢复、旧 CLI 禁用、刷新后节点恢复。
- P0-3：完整历史请求参数、双 ID 唯一性、配置继承、状态不继承、本地事务回滚、Provider 成功后
  幂等恢复、结果未知防重复、跨项目拒绝和长历史增量装载。
- P0-4：归档/恢复补偿、运行中门禁、local-only、侧边栏/设置页过滤。
- P1：四类 target、inline/detached、finding 定位、多次审查隔离、历史恢复。
- P2：plan 增量合并、搜索脱敏、导出 schema/脱敏、批注失效、大执行树性能。

真实桌面验收至少覆盖：

1. 使用支持增强协议的 Codex CLI 完成每个能力的成功路径。
2. 使用不支持对应方法的 CLI 或 method-not-found fixture 验证 UI 降级和基础发送不受影响。
3. 在能力执行中刷新、切换会话、停止 runtime，确认历史、队列和 ID 不错绑。
4. 用长会话、大 Diff、多文件 finding 和大执行树检查响应速度与布局稳定性。

## Delivery Slices

- **Slice A / P0-1**：先写协议与队列状态测试，再接 `turn/steer` 和 Composer 引导动作；单独验收。
- **Slice B / P0-2**：接原生 compact 状态机和历史节点；单独验收。
- **Slice C / P0-3**：完成原生完整会话 Fork API、本地事务与恢复、两处菜单入口和新聊天激活；
  不把 provider turn metadata 或指定轮次 Fork 混入本切片。
- **Slice D / P0-4**：完成归档迁移、同步补偿、侧边栏过滤和设置页恢复；单独验收。
- **Slice E / P1**：先 detached Review + 四类 target + finding 定位，再评估 inline 和处置动作。
- **Slice F / P2**：先 plan/compact 事件，再搜索与导出，最后批注和执行树。

每个 Slice 都必须按 Trellis 续接记录关键决定、验证结果和未完成项；前一个 Slice 未通过真实桌面验收时，
不并入下一个 Slice 的范围。

## Implementation Record
- 2026-08-02 P0-3 原生完整会话 Fork 已完成：顶部菜单与侧边栏右键共用 capability 和门禁，
  新聊天使用独立 CodeM/Codex 双 ID、Provider 原生历史、配置继承和可恢复操作状态；真实双入口、
  运行中/非 Codex 门禁及重启恢复通过，故障恢复和长历史边界由自动化覆盖。P0-4 仍未实现。
- 2026-08-02 P0-1 `turn/steer` 已完成自动化与真实桌面验收；路线下一实施切片切换为 P0-2 原生 compact。
- 2026-08-02 P0-2 原生 Compact 已完成自动化、长历史与真实桌面验收；不支持版本禁用并提示升级，
  不存在 `/compact` 文本回退。路线下一实施切片切换为 P0-3 完整会话“在新聊天中继续”。
- 2026-08-02 P0-3 第一阶段设计调整为官方完整会话 Fork：省略 `lastTurnId`，Provider 历史为唯一
  Fork 来源；指定历史轮次 Fork 后置，不作为当前交付前置。
- 2026-08-01T06:04:28.603Z 当时确认三阶段路线优先级为 P0 会话控制与分支、P1 审查闭环、P2
  过程与产物可观察性；P0 当时按 turn/steer、原生 compact、指定轮次 Fork、Archive/Unarchive
  分片。该 Fork 范围已由上方 2026-08-02 记录修订为先交付完整会话 Fork。Codex 0.146.0 schema
  已核实 steer 使用 expectedTurnId，指定轮次 fork 可使用 lastTurnId/beforeTurnId，不依赖已废弃的
  thread/rollback。

- 2026-08-01T05:57:13.278Z Task created by Trellis automation.

## Verification Results
- 2026-08-01T06:04:58.989Z `roadmap structure and placeholder audit`: pass：三阶段、P0 四里程碑、双 ID、能力降级、回滚、安全和验收章节齐全；无待补充/TBD/TODO/FIXME 或行尾空白

## Completion Summary
- 2026-08-01T06:05:15.162Z 完成 Codex 原生能力接入路线规划：三方向全部纳入，P0 会话控制与分支优先，并拆为 turn/steer、原生 compact、指定轮次 Fork、Archive/Unarchive 四个独立交付切片；功能验收项均保留未完成，后续从 P0-1 续接实现。

## Follow-ups

- 下一步按 P0-4 单独设计并实现 Archive / Unarchive，不在同一变更中混入指定历史轮次 Fork。
- P0-3 后续补测真实 200-turn Provider Fork，以及审批、用户输入和 Compact 瞬时门禁的桌面路径；
  当前自动化证据与真实成功路径边界见 `.trellis/tasks/codex-continue-in-new-chat.md`。
- P1 的逐行评论与 Git 暂存/撤销，以及 P2 的 PDF/DOCX 深度解析，保留为后续独立提案。
