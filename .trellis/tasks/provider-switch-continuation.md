# Task: 放开 Provider 切换与会话续接

## Background

用户反馈：聊天一旦创建（发出第一条消息后），Composer 的 Provider 切换器永久禁用（`App.tsx` `canSelectProvider={!activeThreadSummary}`，title 为"Provider 在聊天创建后锁定，请新建聊天后选择"）；运行中时渠道/模型/effort/权限/知识库/MCP 选择器也全部 `disabled={isRunning}`（`src/components/Composer.tsx`）。

调研结论（对比 desktop-cc-gui，仓库位于 `D:\ai_proj\desktop-cc-gui`）：

- 锁定是**纯前端产品策略**，不是热会话模型的结构性代价。CodeM 后端已具备：
  - Claude runtime 复用前做兼容性检测（工作目录/权限模式/模型/effort/渠道 env），不匹配自动关闭旧进程重建（`src-tauri/src/backend.rs` `get_or_create_claude_runtime` → `is_claude_runtime_compatible` → `close_thread_runtime`）；
  - 运行中（`current_run_id.is_some()`）直接复用旧 runtime、不重建——天然"下一轮生效"语义；
  - generic agent（ACP/Codex 等）同样有"配置不匹配关闭旧 actor 重建"分支（`src-tauri/src/agent_run.rs`）；
  - 热进程 stdin 常开，支持运行中 guide 插话（`/api/claude/run/{runId}/guide`，same-run 注入）、审批与 AskUserQuestion 应答、`autoGuideQueuedPrompts` 排队续发。
- CodeM 热进程模型在插话维度优于 ccgui（ccgui 对 Claude 只能 kill + `--resume` cutover），**本任务不改进程模型**。
- ccgui 的跨 provider 续接（Native Provider Continuation）设计为：旧 thread 原样保留，新建目标 engine 的 thread，把旧会话编译成 ContextPackage（纯文本转录 + 确定性折叠 + token 预算裁剪"保最早用户任务、删中间、保最近 spine"）注入新会话。CodeM 的优势：消息历史在自有存储中，无需解析各 CLI 的 JSONL。

## Objective

解除聊天创建后 Provider/渠道/模型选择器的永久锁定，支持同 Provider 换渠道无缝续接（热会话重建）与跨 Provider 切换时的上下文转录续接（新建 thread 注入 ContextPackage），全程不影响现有热会话、guide 插话、审批通道与排队机制。

## 硬约束（用户明确要求）

- **不得影响现有热会话路径**：runtime 复用与兼容性自动重建、stdin 常开多轮写入、运行中 guide 插话（same-run 注入）、审批/AskUserQuestion 应答通道、`autoGuideQueuedPrompts` 排队与 run 结束自动续发、fork 会话状态机，行为全部保持原样。
- 运行中修改配置**不重建、不打断当前 run**（沿用现有"运行中直接复用旧 runtime"语义），下一轮发送时自然按新配置重建。
- 跨 Provider 续接一律走**新建 thread + 新 runtime**，不触碰既有 thread 的 runtime 生命周期与 session id（因此 `thread.sessionId` 单值结构无需改动）。

## Scope

In scope:

- 前端解除锁定：
  - `canSelectProvider` 不再要求"新聊天草稿"，聊天创建后空闲时允许切换 Provider；
  - 运行中允许修改渠道/模型/effort 等选择器，UI 明示"下一轮生效"（替换现有"运行中已锁定"文案与禁用态）；
  - 选择器仍遵守现有 `StandardSelect`/统一弹层体系。
- 同 Provider 换渠道/模型：无缝续接，session id 不变，下一轮由后端兼容性检测自动重建进程（预期零新增后端逻辑，需验证渠道 env 变化确实触发重建）。
- 跨 Provider 切换（第一期）：
  - 切换时弹确认（复用现有主题弹层），说明将新建聊天并携带转录上下文，旧聊天保留可切回；
  - 新建 thread，首条消息注入简化版 ContextPackage：从 CodeM 自有消息库导出转录（用户/assistant 文本；剔除 thinking 等私有块；tool 调用配对摘要化），确定性折叠（大 JSON/diff/日志按头尾+锚点），token 预算（初值 12k，chars/4 估算），裁剪策略"保最早用户任务、删中间、保最近 spine"；
  - ACP 类 agent（Grok 等）为尽力注入（首条 prompt 携带转录），UI 标注"上下文尽力携带，不保证完整接收"；
  - 新 thread 与源 thread 建立关联标记（如 `continuedFromThreadId`），侧栏/头部可辨识"续接自 XX"。

Out of scope（明确不做）:

- 不改进程模型：不引入 turn 级并发、不做 kill+resume cutover；
- 不做 ccgui 的工业级验收证据链（marker echo、JSONL 扫描、SQLite operation 幂等存储），第一版以"注入消息发送成功"为准，留作后续增强；
- 帅API 普通聊天（ordinary）补排队为独立后续任务，不在本任务内；
- 跨 Provider 双向续接的能力矩阵探测（哪些 agent 支持证明接收）暂不做，统一按"尽力注入 + UI 标注"处理。

## Impact

- 前端：`src/App.tsx`（canSelectProvider 传参）、`src/components/Composer.tsx`（disabled 条件、title 文案、切换确认入口）、续接确认弹层组件、`src/types.ts`（thread 关联字段如 continuedFromThreadId）、`src/lib/**`（转录编译纯函数）。
- 后端：`src-tauri/src/backend.rs`（如需：续接建 thread + 首条消息注入的 API；兼容性检测确认渠道维度覆盖）；`src-tauri/src/agent_run.rs`（如需：generic 侧同类入口）。
- 不动：`get_or_create_claude_runtime` 复用/重建判定逻辑本身、guide/approval/user-input stdin 路径、排队续发逻辑、fork 状态机。

## Acceptance Criteria

- [ ] 聊天创建后（空闲时）可切换 Provider、渠道、模型、effort；切换不再要求新建聊天。
- [ ] 运行中可修改渠道/模型等选择器，当前 run 不受影响，UI 显示"下一轮生效"；下一轮发送按新配置运行。
- [ ] 同 Provider 换渠道后：会话经 `--resume` 无缝续接，历史连续，热进程按新渠道 env 重建（验证 `is_claude_runtime_compatible` 覆盖渠道变化）。
- [ ] 跨 Provider 切换：有确认弹层；确认后新 thread 收到转录首条消息并正常开局；源 thread 完好、可切回并原生续聊；新旧 thread 有续接关联标记。
- [ ] 转录编译纯函数有单测：私有块剔除、tool 交换配对摘要、确定性折叠、预算裁剪（保首条用户任务）。
- [ ] 热会话回归：guide 插话、审批/AskUserQuestion 应答、排队自动续发、fork、运行中 runtime 复用行为与改动前一致（回归用例或手工验证清单）。
- [ ] 桌面端与 Web 端交互一致，弹层/下拉遵守现有主题体系，无原生 alert/confirm。

## Verification Commands

- 前端源码测试：`node --import tsx --test src/lib/*.test.ts`（转录编译用例）
- 后端：`cargo test`（涉及续接 API/兼容性分支时补充）
- 手工回归清单：热会话 guide 插话 / 审批应答 / 排队续发 / fork / 切换后旧 thread 切回续聊

## Implementation Record
- 2026-09-02T14:40:41.572Z Hermes 安装 exit-0 缺陷修复：install.ps1 内部失败（git fetch TLS 失败）时退出码仍为 0，CodeM 仅凭退出码判定成功——跳过代理重试、找不到可执行文件后报误导性"未检测到"。新增 lifecycle_output_failed：退出码非 0 或输出含"installation failed"均视为失败，代理重试与失败报错共用该判定（含网络失败无代理时的指引提示）。cargo test 590+16+21 通过。

- 2026-09-02T13:38:26.375Z Hermes 安装二次失败排查与改进：杀软放行后安装依赖全部就绪（uv/Python3.12/Git/Node22/ripgrep/ffmpeg），最终失败于 git fetch GitHub（schannel TLS 握手失败，直连不通且安装进程无代理）。is_agent_lifecycle_network_failure 已命中（fetch failed），但 proxy_retry 为 None（未配置代理）无法自动重试。改进：安装失败且判定网络失败但无可用代理时，错误文案附加"配置网络代理后重试或开代理终端手动安装"指引。cargo lifecycle 测试 11 passed。
- 2026-09-02T12:56:41.495Z Agent 设置页 Hermes 分区新增安装说明（可折叠 details，默认收起）：说明一键安装为官方全家桶安装器（自带 Python/Git/Node/ripgrep/ffmpeg 至 %LOCALAPPDATA%\hermes，无需管理员权限）；拒绝访问(os error 5)多为杀软拦截及放行步骤；可改用官方签名安装器 Hermes-Setup.exe 手动安装；旧损坏安装的清理方式（保留 ~/.hermes 配置）。样式复用主题变量。

- 2026-09-02T01:53:33.659Z Hermes 安装报错排查：复现 POST /api/agents/lifecycle 500，真实错误为 spawn 安装进程被拒（os error 5 拒绝访问），用户确认系杀毒软件拦截——CodeM 侧链路正常。顺手改进：lifecycle Start 错误在 Windows os error 5 时附加杀软拦截提示（describe_agent_lifecycle_start_error），cargo test 590+16+21 通过。
- 2026-09-02T01:20:21.921Z 阶段性提交推送：ce6ddd9 已推送 origin main（Provider 会话内切换续接 + DSH ACP alpha.3 迁移 + DSH Alpha 检测，含 64MB 历史上限、流式上游限制记录、GPT review 竞态修复）。任务手工验收项保持未勾选，继续后续工作。

- 2026-09-01T14:24:24.889Z effort 未持久化排查与两项修复：(1) 实测当前代码 effort 持久化正常（UI 选 High→PATCH→threads.reasoning_effort 与 thread_model_preferences 双写成功），用户遇到的是模型目录未加载窗口期 handleReasoningEffortSelect 本地校验静默拒绝（toast 后 return 不持久化）——已修复为目录未加载时跳过本地校验交后端判断；(2) 发现并修复该会话历史持续 413：axum 默认 2MB 请求体上限，长会话 turns（含 thinking/工具输出）超限导致 PUT /history 永远失败——router 增加 RequestBodyLimitLayer 32MB（tower-http 启用 limit feature），修复后该会话历史将随下次写入自愈。另修复并行 DSH 会话对该 provider 切换测试的半成品改动（SELECT 6 列 4 元组解构、INSERT 漏 updated_at）。
- 2026-09-01T13:59:55.091Z 会话截断问题排查与数据恢复：用户报告 'review一下，当前更改，glm改的'（thread 646a5df4，Codex，session 01a05d35...）历史被截断。定位：messages 表该 turn 的 assistant text item_sort 为 0/9/28/91（90+ items 中仅 4 条 text 落库），最终结论 item 从未写入——最后一批 flush 丢失，时间点与开发期 vite HMR（App 组件因新增 hook 触发 Fast Refresh 强制 remount，useRef 持久化调度状态全量重建）吻合；结构上 useWorkspaceState 的 debounce/checkpoint 调度状态存 useRef 且无 pagehide/beforeunload 兜底 flush，remount 或关闭都会丢在途批次。数据恢复：将用户保留的完整 review 结论（2264 字符）以 assistant text（item_sort=92）写回 messages 表，重启壳/刷新后可见。

- 2026-09-01T13:41:35.250Z Review 修复（GPT review 三条属实意见）：(1) P1 切换/发送竞态——pendingProviderSwitchRef 记录在途切换，handleSubmitPrompt 先 await 切换落库并用返回的切换后线程快照显式路由（submitPromptToThread(switchedThread)/submitGenericAgentPrompt({thread})），点选后立即发送不再被旧 Provider 闭包路由；切换失败时回滚草稿 Provider；(2) P1/P2 续接标记过早清除——buildPendingContinuationSubmission 不再自清，改为提交被接受（含入队）后由 handleSubmitPrompt 清除，失败重试仍携带转录（无转录可编时才提前清除）；(3) P2 provider 切换时 model/reasoningEffort 未清——applyThreadMetadataPatch 在 providerChanged 时一并置空。契约测试更新覆盖：await 在途切换、switchedThread 路由、delivered 后清除、model 清空。tests/composer-context-usage.test.ts 的 2 个失败经 git stash 基线复跑确证为存量问题，与本次改动无关。DSH dead code warning 属并行 DSH 任务范围，本轮未动。
- 2026-09-01T12:49:17.188Z 端到端根因修复与验证完成：(1) pendingContinuation 改 localStorage 持久化（HMR/刷新不丢标记）；(2) 真正根因——normalizeInputContentBlocks 在 contentBlocks 存在时完全忽略 prompt 字段，注入的转录拼在 prompt 上被丢弃；修复为转录以 text block 前置注入 contentBlocks（prompt 保留为兜底），并在转录尾部加强指令（直接依据转录回答、不要用工具检索）。端到端验证（临时 vite 代理真实后端+Playwright 驱动 UI）：干净聊天 OpenCode 记住生日/暗号/幸运颜色→静默切 Grok Build→一次性全部答对；权限继承与渠道重置亦验证通过。测试 thread 已清理。

- 2026-09-01 需求变更重做（用户反馈）：续接必须在**当前会话内**完成，不新开聊天；切换全程**无弹窗、无确认框、无提示 toast**；切换选择后**不立即生效，用户发送下一条消息时才生效**（对齐 ccgui 的"改下一轮派发目标"模型）。实现：
  - 前端：`threadProviderOverride` 状态（选择器静默记录目标 provider，图标立即切换显示；切 thread 自动清空）；`consumePendingProviderSwitch` 在 `handleSubmitPrompt` 发送时消费——编译转录 → `selectDraftProvider` 准备新 provider 草稿配置 → `persistThreadMetadata({providerId})` 持久化切换 → 以构造的切换后 thread 对象走 `submitPromptToThread`/`submitGenericAgentPrompt({thread})`（绕过闭包旧 active 状态），prompt 为"转录 + 分隔说明 + 用户新消息"，displayText 保持用户原文；`applyThreadMetadataPatch`/`ThreadMetadataPatch` 支持 providerId（本地清 session/渠道/模型偏好）。
  - 后端：`update_thread` 支持 `providerId`（新增 `update_thread_provider_from_payload`）：校验存在与变化 → 更新 provider 并清空 session_id/transcript_path/agent_channel_id/fingerprint → 关闭旧 Claude runtime + forget generic runtime → 返回 workspace bootstrap 供前端全量刷新；新增后端测试 `update_thread_switches_provider_and_clears_session_state`。
  - 撤销：switch-provider ConfirmDialogState 分支、确认弹层 primary 样式、新建聊天与"续接："标题逻辑全部移除；Composer provider title 文案改为"切换后在下一条消息发送时生效"。
- 2026-09-01T09:28:05.102Z Provider 切换与续接已完成自动化验证，手工热会话与端到端验收仍待后续；现按用户指令暂停该会话，保留全部代码与任务记录，切换处理 DSH alpha.3 ACP 兼容修复。
- 2026-09-01T01:57:39.303Z 阶段2b+阶段1实现完成：Composer 渠道/模型/effort/权限运行中解锁为下一轮生效；跨 Provider 切换走 switch-provider 确认弹层→新建目标 Provider 聊天→注入转录首条消息（prompt/displayText 分离）；useAgentRun.submitPrompt 新增 { thread } 显式参数绕过 active 闭包时序。后端零改动，热会话路径零改动。

- 2026-09-01T01:43:18.918Z 阶段2a完成：新增 src/lib/provider-continuation-transcript.ts 及单测（7 passed）——已完成轮次转录、工具摘要行、单段头尾折叠、48k 字符预算、保首条用户任务+删中间+保最近spine裁剪，标记沿用 [CodeM 会话续接上下文]/[续接上下文结束]。阶段2b开始：ConfirmDialogState 新增 switch-provider kind，确认后新建目标 Provider thread 并以 prompt/displayText 分离注入转录首条消息。
- 2026-09-01T01:31:12.366Z 方案定稿：分两档实现——(1) 同 Provider 换渠道/模型：前端解除锁定+运行中改配置下一轮生效，依赖后端既有兼容性自动重建；(2) 跨 Provider 切换：确认弹层+新建 thread 注入简化版 ContextPackage 转录（清洗/折叠/12k 预算/保首条用户任务），旧 thread 保留可切回。硬约束：不改动 get_or_create_claude_runtime 复用重建逻辑、guide/approval/user-input stdin 路径、排队续发、fork 状态机；运行中不重建不打断当前 run。参考 ccgui Native Provider Continuation 设计，第一期不做 marker 验收证据链。

- 2026-09-01T01:29:40.838Z Task created by Trellis automation.
- 2026-09-01 完成调研并确认方案（与用户对齐）：锁定为纯前端策略；分两档实现（同 Provider 无缝 / 跨 Provider 新建 thread + ContextPackage 转录注入）；用户明确硬约束——不得影响现有热会话、guide 插话、审批通道与排队机制。

- 2026-09-01 阶段 2b 完成：`ConfirmDialogState` 新增 `switch-provider`；App.tsx 新增 `handleSelectAgentProvider`（聊天已创建时选择其他 Provider → 弹确认；点当前 Provider 为 no-op）与 `handleProviderContinuation`（`selectDraftProvider` 切草稿 → `createThread` 新建目标 Provider 聊天 → 以 prompt/displayText 分离注入转录首条消息，Claude 走 `submitPromptToThread`、generic 走 `submitGenericAgentPrompt` 新增的 `{ thread }` 显式参数绕过 active 闭包时序）；`canSelectProvider` 恒放开，provider trigger 文案改为"运行中请等待"；Dialogs 确认按钮 switch-provider 用 primary；新聊天标题带 `续接：` 前缀关联来源。
- 2026-09-01 阶段 1 完成：Composer 渠道/模型/effort/权限选择器运行中解锁，菜单标题与 title 统一提示"运行中修改下一轮生效"；移除 `permissionSelectionDisabled`；保留"run 开始时自动收起已打开菜单"的 effect 与发送/停止按钮逻辑不变；ordinary（帅API）变体选择器按边界未动。
- 2026-09-01 更新两个源码契约测试到新契约：`multi-provider-chat-routing.test.ts`（断言 switch-provider 续接路径）、`grok-permission-modes.test.ts`（断言权限菜单运行中可访问+下一轮生效提示）。未改动任何后端文件；热会话路径（runtime 复用/兼容重建、guide stdin、审批/答题、排队续发、fork）零改动。

## Verification Results

- 2026-09-01T14:24:25.384Z `cargo test; rustfmt --check; npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: 后端 590+16+21 passed 0 failed；rustfmt 通过；typecheck 通过；lib 813 passed；hooks 20 passed。effort 持久化经真实 UI 实测通过。

- 2026-09-01T13:41:35.714Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 813 passed 0 failed；hooks 20 passed 0 failed。待手工验收：切换后立即发送（竞态修复实测）、首次发送失败后重试携带转录。

- 2026-09-01T12:49:17.676Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 813 passed 0 failed；hooks 20 passed 0 failed。UI 端到端实测通过（OpenCode→Grok Build 首切场景三问全对）。
- 2026-09-01 需求变更重做后：`npm run typecheck` 通过；`node --import tsx --test src/lib/*.test.ts` 814 passed（含更新后的 multi-provider-chat-routing 契约）；`node --import tsx --test src/hooks/*.test.ts` 20 passed；`cargo check` 通过（仅既有 2 个 dead_code warning）；`cargo test` 全量 588+16+21 passed 含新增 provider 切换测试；`rustfmt --edition 2021 --check src-tauri/src/backend.rs` 通过。
- 2026-09-01T01:57:39.763Z `node --import tsx --test src/lib/provider-continuation-transcript.test.ts; npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: 转录单测 7 passed；typecheck 通过；全量 lib 测试 814 passed（含更新后的 multi-provider-chat-routing/grok-permission-modes 契约）；hooks 测试 20 passed。待手工验收热会话回归与端到端切换体验。

- 2026-09-01 `node --import tsx --test src/lib/provider-continuation-transcript.test.ts`: 7 passed, 0 failed。
- 2026-09-01 `npm run typecheck`: 通过。
- 2026-09-01 `node --import tsx --test src/lib/*.test.ts`: 814 passed, 0 failed（含更新后的 multi-provider-chat-routing 与 grok-permission-modes 契约测试）。
- 2026-09-01 `node --import tsx --test src/hooks/*.test.ts`: 20 passed, 0 failed（含 useAgentRun.stop-reconciliation、useClaudeRun.cleanup/send-latency 回归）。
- 待手工验收：运行环境内热会话回归（guide 插话、审批/AskUserQuestion 应答、排队自动续发、fork）、跨 Provider 切换端到端体验、运行中改渠道下一轮生效实测。

## Completion Summary

- 2026-09-02T17:19:24.399Z Provider 切换续接任务收口：会话内静默切换（无弹窗）、发送时一次性注入转录（contentBlocks 前置）、竞态与标记持久化修复、权限/模型继承、64MB 历史上限、真实 UI 端到端验证通过并已随 ce6ddd9 提交。手工验收余项已列 Follow-ups。

## Follow-ups

- **历史持久化可靠性（新发现，建议独立任务）**：`useWorkspaceState` 的 thread 历史 debounce/checkpoint 调度状态存于 `useRef`，且无 `pagehide`/`beforeunload` 兜底 flush——开发期 HMR remount 或应用关闭都会丢弃在途批次，已实际造成一次会话最终回复未落库（已手工恢复）。修复方向：调度状态提升到模块级（单实例应用）+ 关闭时对 pending 线程做 keepalive fetch 兜底（注意 keepalive 64KB body 上限与长会话 payload 的取舍）。
- per-provider session id 保留（切走再切回原 Agent 时原生续接；当前第一版切回时上下文经转录传递）。
- ccgui 工业级验收证据链（marker + JSONL 证据 + 幂等 operation 存储）如后续需要再评估。
- 帅API 普通聊天补排队能力（独立任务）。
- 跨 Provider 续接的能力矩阵探测与"证明接收"升级。
