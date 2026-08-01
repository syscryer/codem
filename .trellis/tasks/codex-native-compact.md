# Task: Codex 原生会话压缩

## Background

CodeM 当前只把 `/compact` 作为 Claude 范围的本地命令：前端创建普通会话 turn，向 Provider 发送
`/compact` 文本，并通过 `reuseSession=false` 开启新的 Claude 会话。Codex 已通过 App Server 提供
`thread/compact/start`，但 CodeM 尚未接入，因而无法可靠识别压缩是否开始、完成或失败，也不能呈现
Codex 自动压缩节点。

本机 `codex-cli 0.146.0` 的 experimental schema 已确认：

- `thread/compact/start` 请求只接收 `threadId`，响应为空对象；响应成功只表示请求被接受，不表示压缩完成。
- 原生生命周期以特殊 compact turn 和 `contextCompaction` ThreadItem 为主。
- `thread/compacted` 通知已标记 deprecated，只能作为旧协议兼容信号。
- compact turn 不支持 steer，必须与普通 turn 串行执行。

本任务是 `.trellis/tasks/codex-capability-parity-roadmap.md` 的 P0-2。P0-1 `turn/steer` 已完成，
本任务沿用现有 Agent 热运行时、队列和会话历史基础，不重写 Codex bridge。

## Objective

为 Codex Provider 接入原生 `thread/compact/start`，建立可恢复、可观察且不会与普通 turn 并发的
会话压缩状态机；保留 Claude 等其他 Provider 的现有行为。

## Scope

In scope:

- `/compact` 与上下文用量弹层中的“压缩上下文”按钮共用同一入口。
- Codex compact 能力探测、内存缓存、旧 CLI 禁用态和升级提示。
- 将 Compact 作为现有 thread 热运行时 actor 的一等串行操作。
- 活动 turn 结束后优先执行 compact，再继续普通排队消息。
- 手动与自动 compact 的结构化事件、单卡片历史节点和持久化恢复。
- 失败后的重试、跳过并继续、队列暂停和进程重启后的只读核对。
- Claude `/compact`、普通 Agent turn、steer 和队列行为的回归保护。

Out of scope:

- 不为 Claude、Grok、OpenCode 或 Pi 改造原生压缩协议。
- 不发送普通 `/compact` 文本作为 Codex 降级，不在本地生成摘要伪装原生压缩。
- 不修改、删除或折叠 CodeM 已保存的可见历史。
- 不新增 SQLite 表，不持久化能力探测结果为长期真相。
- 不实现自定义 compact prompt、自动压缩阈值设置或压缩内容正文展示。
- 不与 P0-3 Fork、P0-4 Archive、P1 Review 或 P2 全文搜索/导出同批实现。

## Confirmed Product Decisions

- 旧 Codex CLI 不支持 `thread/compact/start` 时禁用入口并提示升级，不执行文本回退。
- 运行中发起 compact 时加入控制队列；当前 turn 完成后，compact 先于普通排队消息执行。
- 等待中或执行中的 compact 不跨进程自动重放；重启后只读核对原生历史。
- 每次压缩使用一个轻量系统卡片，原位更新等待、运行、完成、失败或中断状态。
- 压缩失败后暂停普通队列，必须由用户选择“重试压缩”或“跳过压缩并继续发送”。
- 手动入口同时提供 `/compact` 和上下文用量弹层按钮，两者不形成两套逻辑。

## Architecture

### Frontend coordinator

- `useAgentRun` 增加按 CodeM thread ID 隔离的 compact coordinator，维护能力、操作状态和队列屏障。
- Compact 是控制操作，不作为 `QueuedAgentPrompt` 塞入普通提示词队列。
- `/compact` 与上下文弹层按钮调用同一个 `requestThreadCompaction` 行为。
- 当前 turn 存在时只创建 `waiting` 操作；terminal 事件到达后先调度 compact，再考虑普通队列。
- 手动操作和 Codex 自动上报的 compact 都归一化为同一系统事件模型。

### Backend runtime actor

- 新增 `POST /api/agents/runtime/{thread_id}/compact`，请求携带当前 Codex `sessionId`、工作目录、
  channel/runtime 配置和前端 operation ID；响应复用有界事件流，不把 compact 伪装成普通 run。
- `AgentRuntimeCommand` 扩展一等 `Compact` 变体。actor 只在没有普通 turn 或其他 compact 时执行，
  并在后端再次拒绝重复操作，不能只依赖前端防重。
- 热运行时不存在时只能 resume 请求中的既有 Codex thread；不得为 compact 隐式 start 新 thread。
- resume 返回的 Codex thread ID 必须与请求 `sessionId` 一致，否则停止操作并返回冲突错误。
- `CodexConnection` / `CodexStdioClient` 增加 capability probe、compact request 和 compact lifecycle 聚合。

### Capability detection

- 不按 Codex 版本号写死支持矩阵。
- 初始化 experimental API 后，对 `thread/compact/start` 发送缺少必填 `threadId` 的无副作用探测请求。
- JSON-RPC `method not found` 判定 `unsupported`；`invalid params` 判定 `supported`；其他错误判定
  `error`，不得乐观开启入口。
- 探测不携带真实 thread ID，不允许触发压缩；结果按可执行命令/runtime 配置做进程内缓存。
- Provider 诊断或模型目录预热可提前完成探测；真实 runtime 建立后仍需校验自身能力。

## State Machine And Queue Barrier

操作状态：

`waiting -> preparing -> running -> completed | failed | interrupted`

- `waiting`：存在活动 turn，compact 等待成为队首控制屏障。
- `preparing`：正在恢复 runtime、校验 session ID 或探测能力。
- `running`：原生请求已接受，并已观察到 compact turn/item 生命周期；请求空响应不能单独证明完成。
- `completed`：观察到 `contextCompaction` 完成及成功 terminal turn；旧协议仅在缺少新 item 时兼容
  `thread/compacted`，并按 provider IDs 去重。
- `failed`：能力不支持、RPC 明确失败、compact turn 失败、超时或子进程退出。
- `interrupted`：应用恢复时无法从原生历史确认之前的 waiting/preparing/running 操作已完成。

队列规则：

- 同一 thread 同时最多一个未终结 compact；重复入口只定位现有卡片并给出状态提示。
- compact 等待或运行期间，普通消息仍可进入可见队列，但不得启动 turn。
- `completed` 自动释放屏障并启动下一条 ready 消息。
- `failed` 保留屏障；“重试”复用原卡片并递增 attempt，“跳过并继续”记录 skipped resolution 后释放屏障。
- 自动 compact 由原生事件创建/更新卡片，不创建人工请求，也不提供“跳过”动作。
- 自动 compact 发生在普通 Codex turn 内时，沿用该 runtime 的串行保障，不额外启动控制操作。

## Data And Persistence

优先复用现有会话历史 JSON，并在 `src/types.ts` 集中新增兼容类型：

- `ConversationTurn.kind?: 'message' | 'system'`；旧数据缺省为 `message`。
- `CompactSource = 'manual' | 'automatic'`。
- `CompactOperationStatus = 'waiting' | 'preparing' | 'running' | 'completed' | 'failed' | 'interrupted'`。
- Compact metadata 至少保存 `operationId`、`source`、`status`、`attempt`、`resolution`、
  `providerThreadId`、可用的 `providerTurnId/providerItemId`、时间戳和受限错误信息。

系统事件 turn 不渲染虚假的用户消息或助手正文，只承载一个 `system-command` compact 卡片。
等待/运行卡片状态作为恢复事实写入历史；能力探测缓存、活动 runtime 句柄和可自动重放的请求载荷
不得写入历史。

原生 compact 生命周期能关联当前 manual operation ID 时标记 `manual`；没有活动 manual operation 可关联的
原生节点才标记 `automatic`。不得根据 token 阈值、卡片时间或自然语言推测来源。

恢复时：

1. 加载历史中的 waiting/preparing/running compact 节点。
2. 只读 resume/thread read，并按 provider turn/item ID 查找已完成 `contextCompaction`。
3. 能确认完成则更新原卡片；无法确认则标记 `interrupted` 并提供手动重试。
4. 不自动再次调用 `thread/compact/start`。

## UI Design

- Codex 能力为 `supported` 且存在有效 `sessionId` 时启用 `/compact` 和上下文弹层按钮。
- `unknown/checking/error/unsupported`、无会话或已有 compact 时显示准确禁用原因。
- unsupported 文案明确要求升级 Codex CLI；不会将命令提交为普通消息。
- 卡片紧凑展示来源、状态、开始/完成时间和必要错误，不弹阻塞式对话框。
- 失败卡片提供带 tooltip 的重试图标按钮，以及清晰的“跳过并继续”命令。
- 重试原位更新同一卡片；跳过后显示“压缩失败，已跳过”。

## Error Handling And Safety

- 所有请求同时校验 CodeM thread、Provider、runtime、Codex session ID 和工作目录归属。
- RPC accepted、item started、item completed 和 terminal turn 是不同事实，不得相互冒充。
- 超时或事件流断开属于不确定结果：先暂停队列并进入 failed/interrupted，不自动重试。
- 失败不清空历史、不替换 `sessionId`、不创建新 Codex thread。
- 历史、debug、raw events 和 trace 不保存压缩后的上下文正文、compact prompt、环境变量或原始协议包。
- 公共错误需要长度限制和凭证清理；诊断只保留方法、状态、operation/provider ID 摘要。

## Impact

- `src-tauri/src/codex_app_server.rs`：能力探测、compact 请求、生命周期聚合与协议测试。
- `src-tauri/src/agent_runtime.rs`：通用 compact 事件与控制类型。
- `src-tauri/src/agent_run.rs`：专用 API、actor Compact 命令、runtime/session 校验与事件流。
- `src/types.ts`：系统事件 turn、compact 状态、来源和 metadata 类型。
- `src/hooks/useAgentRun.ts`：compact coordinator、屏障、恢复、重试和跳过。
- `src/App.tsx`、`src/components/ComposerContextIndicator.tsx`：双入口接线和禁用态。
- `src/components/ConversationTurn.tsx`：compact 卡片状态与操作。
- `src/lib/queued-prompts.ts` 及相关 helper/tests：compact 屏障优先级和终态恢复。
- `src/styles.css`：复用主题变量的紧凑状态与动作样式。

## Acceptance Criteria

- [ ] 支持的 Codex runtime 可通过两个入口执行真实 `thread/compact/start`，且不会发送 `/compact` 文本。
- [ ] 运行中请求严格按“当前 turn -> compact -> 后续普通消息”执行。
- [ ] 同一 thread 不会并发或重复启动 compact；不同 thread 互不阻塞。
- [ ] 卡片从等待/准备/运行原位进入完成、失败或中断，并区分手动与自动来源。
- [ ] 请求接受不会提前标记完成；完成和失败由原生 item/turn 生命周期确认。
- [ ] 成功后原 `sessionId` 不变、可见历史不丢失、普通队列自动继续。
- [ ] 失败后普通队列暂停；重试和跳过均按确认规则恢复，且不产生重复卡片。
- [ ] 应用重启不自动重放 compact；可从原生历史补齐完成，无法确认则标记中断。
- [ ] 旧 CLI/方法不存在时两个入口禁用并提示升级，不生成历史假成功节点。
- [ ] 自动 compact 只依据 Codex 原生事件展示，不根据 token 阈值伪造。
- [ ] 历史和日志不包含压缩正文、提示词、凭证、环境变量或无界原始事件。
- [ ] Claude `/compact`、Codex steer、普通 Agent 运行和队列行为无回归。
- [ ] 长历史更新 compact 卡片时只更新目标 turn，不进行不必要的整树重建。

## Verification Commands

详细的 TDD 任务拆分、精确代码路径、测试命令与提交边界见
[`codex-native-compact-implementation-plan.md`](./codex-native-compact-implementation-plan.md)。

- `node --import tsx --test src/lib/codex-compact.test.ts src/lib/queued-prompts.test.ts src/lib/claude-slash-system-commands.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml codex`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run`
- `$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' }); node --import tsx --test $testFiles`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- `npm run desktop:dev` 后按本任务桌面验收步骤手工验证。

## Desktop Acceptance

1. 创建 Codex 会话并完成至少一轮对话。
2. 分别从 `/compact` 和上下文用量弹层触发压缩。
3. 在回答运行中发起压缩并再排队一条消息，确认顺序为 turn、compact、queued prompt。
4. 确认成功前后 `sessionId` 不变、原历史仍可查看、后续消息可继续运行。
5. 重启后确认已完成节点可恢复，无法确认的未完成请求显示“已中断”。
6. 用 mock App Server 验证 unsupported、明确失败、超时、重复事件和进程退出。
7. 确认失败时队列暂停，重试与跳过均能恢复且不会重复发送消息。

## Implementation Record
- 2026-08-01T18:48:38.549Z 完成 Task 1：Codex App Server 新增 thread/compact/start 无副作用能力探测、手动压缩生命周期聚合、旧 thread/compacted 兼容优先级，以及普通 turn 自动 contextCompaction 的 started/completed 事件；成功必须同时满足 accepted、context item completed 和同 turn terminal completed。

- 2026-08-01T18:29:56.794Z Codex 原生 Compact 实施计划已完成：9 个任务、67 个可勾选步骤，覆盖协议探测、actor 串行、队列屏障、双入口、系统卡片、失败恢复、自动压缩、历史 round-trip、重启只读核对、性能与桌面验收；计划位于 .trellis/tasks/codex-native-compact-implementation-plan.md。
- 2026-08-01T18:08:22.525Z P0-2 完整设计已按用户确认写入任务文件，并完成占位符、内部一致性、范围和歧义自审；当前只提交设计与 session record，尚未进入实现。

- 2026-08-01T18:03:22.821Z 用户确认 compact 界面、持久化与安全边界：双入口按能力和会话状态禁用；单卡片展示；复用历史 JSON 的兼容系统事件 turn 与类型化 compact metadata，不新建 SQLite 表；重启只读核对；能力缓存仅内存；不保存上下文正文、环境、敏感错误或原始协议。
- 2026-08-01T18:02:30.696Z 用户确认 compact 状态机与队列规则：waiting/preparing/running/completed/failed/interrupted；重复请求定位原卡片；完成自动释放队列，失败等待 retry 或 skip；重试复用卡片，跳过保留失败事实后放行；自动 compact 复用卡片但无跳过动作。

- 2026-08-01T18:01:22.508Z 用户确认架构与数据流：前端按 thread 独立协调 compact 和队列屏障；双入口共享；后端专用接口将 Compact 串行交给现有热 runtime actor；事件映射携带 provider thread/turn/item ID；历史使用控制型系统节点，自动压缩复用同一模型。
- 2026-08-01T18:00:09.709Z 用户确认采用方案 1：扩展现有 thread 热运行时 actor，将 Compact 作为一等原生操作串行执行；不启动独立竞争进程，不复用普通 prompt 伪装压缩。

- 2026-08-01T17:54:22.674Z 实现路径调研结论：Agent 热运行时 actor 已按 thread 串行处理 Run，适合扩展为一等 Compact 命令并天然落实互斥。能力探测不写死 CLI 版本：初始化后以缺少必填 threadId 的 thread/compact/start 请求做无副作用探测，method not found 判定 unsupported，invalid params 判定 supported，并仅做进程内缓存。备选的独立 app-server 进程会与热 runtime 产生竞态，普通 /compact prompt 又不是真正原生压缩，均不推荐。
- 2026-08-01T17:51:40.264Z 用户确认 manual compact 双入口：保留 /compact，并在上下文用量弹层增加‘压缩上下文’按钮；两个入口必须调用同一控制流程，共享能力判断、互斥、队列屏障、历史卡片和失败恢复，不形成两套逻辑。

- 2026-08-01T17:50:50.607Z 用户确认 compact 失败后的队列策略：失败后保持 compact 屏障并暂停普通排队消息，卡片提供‘重试压缩’与‘跳过压缩并继续发送’两个明确动作；未获用户选择前不得自动继续，也不做隐式自动重试。
- 2026-08-01T17:38:55.914Z 用户确认 compact 历史展示：每次压缩使用单个轻量系统卡片，状态按 waiting/running/completed/failed 原位更新并持久化；区分 manual 与 automatic 来源。失败状态保留可读原因和重试动作，避免为 started/completed/failed 各生成一条历史记录。

- 2026-08-01T17:34:24.189Z 用户确认 compact 重启恢复策略：等待中或执行中的 compact 不跨进程自动重放。应用恢复后先 resume Codex thread 并读取原生历史；存在已完成 contextCompaction item 时同步完成节点，否则把本地请求标记为已中断并提供手动重试。不得静默丢弃，也不得自动重复压缩。
- 2026-08-01T17:18:00.104Z 用户确认 compact 与活动 turn 的互斥策略：运行中输入 /compact 时加入控制队列；当前 turn 完成后，compact 作为队列屏障优先执行，完成或明确失败后才允许普通排队消息继续；不得中断当前 turn，也不得并发启动 compact 与 turn。

- 2026-08-01T17:16:58.589Z 用户确认旧版 Codex CLI 兼容策略：当 thread/compact/start 不受支持时，禁用 Codex 的 /compact，并明确提示升级 Codex CLI；不回退发送普通 /compact 文本，不伪装为已完成压缩。Claude 等其他 Provider 的既有行为保持不变。
- 2026-08-01T17:15:36.169Z 完成 P0-2 现状与协议核对：现有 /compact 仅对 Claude 暴露，并通过普通 prompt + reuseSession=false 执行；本机 codex-cli 0.146.0 experimental schema 确认 thread/compact/start 仅接收 threadId、响应为空对象，压缩过程通过 contextCompaction ThreadItem（item started/completed）表达，thread/compacted 通知已标记 deprecated。实现应以结构化 item 生命周期为主、deprecated 通知仅作兼容。

- 2026-08-01T17:14:04.616Z Task created by Trellis automation.

## Verification Results
- 2026-08-01T18:48:38.552Z `cargo test --manifest-path src-tauri/Cargo.toml compact_ -- --nocapture`: 通过：9 个 compact probe/lifecycle/automatic 用例，0 失败；仅有既有 dead-code 与 Windows linker warnings。

## Completion Summary

## Follow-ups

- P2 再评估压缩前后 token 对比、自定义 compact prompt 和更完整的会话过程检索。
- 若后续多个 Provider 提供原生 compact，再抽取跨 Provider capability；本任务不提前泛化协议。
