# Task: 修复移动端续聊运行失败

## Background

移动伴侣会复用桌面线程和通用 Agent API。2026-08-16 的 DeepSeek DSH 真机回归发现，桌面端选择 `High` 可以正常运行，但移动端没有展示思考等级，随后 DSH `session.selectModel` 收到 `reasoningEffort: null` 并返回 `invalid payload`。移动端自定义渠道模型目录只读取了渠道中的模型 ID，没有合并 DSH 原生模型目录提供的 `off/high/max` 能力，是这次前后端差异的直接原因。

此前同一任务还覆盖了 Claude 失效 session 自动恢复与 Safari HTTP UUID 兼容；这些已完成行为必须继续保持。

## Objective

修复移动端 DeepSeek DSH 思考等级缺失与运行失败，让移动端复用桌面端同一模型能力和线程元数据契约，同时保持桌面前端隔离。

## Scope

In scope:

- 识别 Claude Code 的失效恢复会话错误。
- 移动端在尚未产生有效输出时，移除失效 `sessionId` 并自动重试一次。
- 清理线程中的失效 session，并在新会话建立后继续同步 session metadata。
- 在移动实时事件和历史记录中保留脱敏后的具体错误与恢复提示。
- 为失效 session 分类、单次重试和移动历史序列化补充测试。
- 合并 DSH 原生模型能力与移动自定义渠道模型，恢复 `off/high/max` 思考等级。
- 移动续聊写回模型、思考等级、权限和渠道选择。
- DSH `session.selectModel` 不发送值为 `null` 的可选字段。
- 缺少渠道密钥时显示脱敏、可操作的错误，不暴露密钥内容。

Out of scope:

- 修改桌面端 `/api/claude/run` 的请求或自动恢复行为。
- 对网络、模型额度、权限拒绝等非 session 失效错误进行自动重试。
- 重构桌面会话恢复 UI 或通用聊天渲染结构。

## Impact

- Backend: `src-tauri/src/mobile_companion.rs` 移动桥接与 `src-tauri/src/backend.rs` 错误分类。
- Frontend shared classification: `src/hooks/useClaudeRun.ts` 仅扩充错误文本识别。
- Mobile UI/data: 移动事件清洗、turn 持久化与恢复提示展示。
- Compatibility: 桌面端请求流程保持不变；正常 session、非 Claude Provider 和已产生输出的运行不自动重试。

## Acceptance Criteria

- [x] `No conversation found with session ID` 被分类为 `resume-session-missing`。
- [x] 移动端 Claude Code 续聊遇到明确失效 session 时自动移除 session 并仅重试一次。
- [x] 正常 session、非 Claude Provider、已产生有效输出或其他错误不触发自动重试。
- [x] 自动恢复成功后流式输出继续到同一个移动 turn，并写回新的 session metadata。
- [x] 自动恢复失败时移动端显示具体、已脱敏的错误和可用恢复操作，不再只有“运行失败”。
- [x] 桌面端现有会话恢复语义与请求流程不变。
- [x] 类型检查、Rust 格式/测试、前端构建和 diff 检查通过。
- [x] DSH 自定义渠道在移动新建任务和会话详情中显示与桌面一致的思考等级。
- [x] 未保存思考等级的既有 DSH 线程默认显示并发送模型目录声明的默认值 `high`。
- [x] 选择模型默认值或默认思考等级时可清理旧线程偏好，发送后刷新不回跳。
- [x] DSH 省略 reasoning effort 时不再触发 `invalid payload for session.selectModel`。
- [x] 缺少 DSH 渠道密钥时移动端展示可操作提示，且不泄露凭据。
- [x] 模型、思考等级、权限和渠道选择后立即写入共享线程元数据，重新进入会话保持不变。
- [x] 桌面端修改同一线程设置后，移动端重新进入该会话时恢复新值；不向桌面组件加入移动端条件分支。
- [x] 设置同步不依赖 2 秒全量轮询或移动路由级 bootstrap 刷新；进入会话详情时读取共享线程状态，会话消息继续使用单线程实时事件流。

## Verification Commands

- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- `git diff --check`
- 使用失效 session 的既有移动 thread 真链路发送消息，确认自动新建 session、流式响应和 session 写回。

## Implementation Record
- 2026-08-16T00:58:57.080Z 按用户确认将设置同步限定为进入会话详情：移除 MobileApp 路由切换时的全量 bootstrap 刷新；会话详情继续由 useMobileThread 挂载读取共享线程状态，实时消息流保持不变。

- 2026-08-16T00:51:40.025Z 用户确认设置双端同步采用进入会话时拉取，不使用 2 秒全量 bootstrap 轮询。保留单会话实时事件流用于消息与运行状态；移除全局 sync heartbeat 和移动路由级 bootstrap 刷新，由会话详情入口读取共享线程状态。
- 2026-08-16T00:49:14.266Z 用户明确要求模型、思考等级、权限、渠道均按线程立即持久化并在桌面/移动两端同步。决定新增受移动认证保护的 settings PATCH，内部复用桌面 /api/threads/:id 元数据更新契约；移动前端独立，不修改桌面组件。

- 2026-08-16T00:44:17.721Z 定位到 DSH 移动失败与思考等级缺失同源：移动线程未恢复默认 reasoning effort，DshClient::select_model 将 None 序列化为 reasoningEffort:null，DSH schema 将其拒绝为 invalid payload；用户确认桌面端携带 High 时可用。范围增加移动 composer 思考等级恢复与 DSH 可选字段协议修复。
- 2026-08-15T16:58:21.004Z 用户确认 iPhone Safari 实机已恢复正常。移动启动层已补齐 randomUUID 兼容，并增加 React 错误边界与缓存清理恢复入口。

- 2026-08-15T16:53:10.410Z 复现手机发送后白屏：HTTP 非安全上下文缺少 crypto.randomUUID，流式文本 reducer 抛 TypeError。新增客户端 ID 生成器，桌面/安全上下文仍优先原生 randomUUID，HTTP 下使用 getRandomValues 生成 RFC 4122 v4 ID。
- 2026-07-30T09:31:02.428Z 完成移动 live/history 去重与延迟刷新取消；真实连续两轮 MOBILE_DEDUPE_ONE_OK / MOBILE_DEDUPE_TWO_OK 在 100ms 采样中始终仅一个 prompt turn，未出现已停止，sessionId 保持 0578514f-1ba0-4f15-ac19-b068a19446d3 且 transcript 存在。

- 2026-07-30T09:28:36Z 移动 API 拼接 live turn 时替换同一 run 或同 prompt 且启动时间接近的瞬态历史 turn；移动 hook 在新非终态事件到来时取消上一轮延迟刷新，避免连续热会话出现重复回合和“已停止”闪现。
- 2026-07-30T06:20:14.243Z 真实连续两轮验收在第二轮 500ms-1900ms 捕获同一 prompt 的重复回合和已停止闪现。确认 mobile_thread 在 desktop history 已有当前瞬态 turn 时仍无条件追加 live turn；计划在移动 API 聚合边界按 runId 或同 prompt+近似 startedAt 去重，并同时取消新非终态事件到来前残留的 terminal refresh。
- 2026-07-30T05:54:10.943Z 真链路自动恢复已返回 MOBILE_SESSION_RECOVERY_OK，但 SQLite session_id 仍为空；补充移动桥接在 session/done 事件携带有效 sessionId 时通过现有线程 PATCH 接口持久化，并避免重复写入。

- 2026-07-30T01:59:28.551Z Task created by Trellis automation.

## Verification Results

- 2026-08-16T01:06:15.864Z `移动端真实 DSH 会话进出、桌面 PATCH 同步与流式发送`: 通过：移动端选择 Max 后重新进入仍保持；桌面共享线程 API 改为 High 后，移动端重新进入恢复 High；发送固定测试文本后先进入思考中并流式返回 MOBILE_DSH_SETTINGS_SYNC_OK，无 invalid payload；全局 2 秒轮询和路由级 bootstrap 刷新均已移除。
- 2026-08-16T01:05:53.245Z `NO_PROXY=127.0.0.1,localhost cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 格式检查成功；576 项测试通过、0 失败、1 项需认证 Grok CLI 的 smoke test 显式忽略。首次未排除本机代理时，关闭 localhost 端口测试被代理返回 502；设置 NO_PROXY 后完整通过。

- 2026-08-16T01:05:45.337Z `npm run typecheck; node --import tsx --test src/lib/client-id.test.ts src/lib/agent-run-events.test.ts src/mobile/*.test.ts src/mobile/hooks/*.test.ts; npm run build`: 通过：TypeScript 检查成功，移动与共享事件回归 44/44，通过 Vite 生产构建。
- 2026-08-15T16:58:21.444Z `npm run typecheck; node --import tsx --test src/lib/client-id.test.ts src/mobile/*.test.ts src/mobile/hooks/*.test.ts; npm run build; iPhone Safari 实机发送`: 通过：26/26，构建成功，用户确认手机端已正常。

- 2026-08-15T16:53:10.824Z `npm run typecheck; node --import tsx --test src/lib/client-id.test.ts src/mobile/*.test.ts src/mobile/hooks/*.test.ts; npm run build; 浏览器真实发送与流式回复`: 通过：25/25；构建成功；Tailscale HTTP 下连续发送 MOBILE_HTTP_ID_OK，流式回复完整、无新控制台异常；390px 无横向溢出。
- 2026-07-30T09:31:11.499Z `移动 HTTPS 连续热会话真链路`: pass：两轮流式期间 promptCount 始终 1、stoppedCount 始终 0、最终各 1 个回复；sessionId 非空且 transcript 存在

- 2026-07-30T09:31:10.244Z `git diff --check`: pass：无 whitespace error，仅既有 CRLF 提示
- 2026-07-30T09:31:08.899Z `npm run build`: pass：Vite production build 成功

- 2026-07-30T09:31:07.521Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass：217 passed，1 ignored（需认证 Grok CLI 的显式 smoke test）
- 2026-07-30T09:31:06.210Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

- 2026-07-30T09:31:04.912Z `node --import tsx --test src/mobile/hooks/useMobileThread.test.ts src/lib/agent-run-events.test.ts`: pass：11 passed，覆盖旧 terminal 隔离、optimistic turn 绑定与事件语义
- 2026-07-30T09:31:03.619Z `npm run typecheck`: pass：TypeScript project references 检查通过

## Completion Summary

- 2026-08-16T01:06:40.763Z 完成移动端 DSH 模型能力合并、思考等级恢复、共享线程设置持久化、DSH 可选字段协议修复与安全错误提示；同步策略收口为进入会话详情读取共享状态，不使用 2 秒轮询或路由级全量刷新。真实 DeepSeek 流式发送、双端设置同步、44 项前端回归、生产构建和完整 Rust 测试均通过，桌面前端未加入移动端分支。
- 2026-08-15T16:58:21.882Z Safari HTTP 白屏已完成兼容与实机验证；桌面入口未加载移动兼容层和错误边界。

- 2026-08-15T16:53:11.229Z 移动端 HTTP 发送白屏已修复并完成真实浏览器回归，桌面端原生 UUID 路径保持不变。
- 2026-07-30T09:31:22.871Z 修复移动端旧 Claude session 自动恢复、错误脱敏与 session 回写，并消除连续热会话中 live/history 重复合并造成的已停止闪现；真实 HTTPS 两轮流式、完整前后端测试与构建均通过，桌面端请求流程保持不变。

## Follow-ups

- 无。
