# Task: Codex 运行中引导

## Background

CodeM 已有跨会话隔离的运行中消息队列，Claude Code 还支持把队列项主动引导到当前运行。
通用 Agent 链路的 `useAgentRun.guideQueuedPrompt` 目前固定提示 Provider 不支持，因此 Codex 即使
App Server 0.146.0 已提供 `turn/steer`，用户仍只能等待当前轮次结束后自动发送下一轮。

Codex 当前热 runtime 已持有 App Server connection、provider thread ID 和活动 turn ID，最可靠的
实现是沿用现有 run control channel，把纯文本引导请求送到正在读取 Codex JSON-RPC 的同一事件循环，
由该循环使用实际活动 turn ID 作为 `expectedTurnId`。

## Objective

接入 Codex `turn/steer`，让纯文本排队消息可由用户主动引导当前轮次，失败不丢消息且其他 Provider 行为不变

## Scope

In scope:

- 为通用 Agent run 增加受控 `/guide` API，将请求写入当前 run 的 control channel。
- 新增通用 `AgentControlCommand::Guide`，Codex 活动 turn 使用 `threadId`、`expectedTurnId` 和纯文本 input 发起 `turn/steer`。
- 只有 App Server 确认成功后才把队列项移除，并在当前 turn 追加“已引导当前运行”紧凑卡片。
- 已知拒绝时恢复 ready 队列状态；响应超时、连接关闭等不确定结果标记为 `guide-unknown`，不得自动发送下一轮。
- 请求处理中标记 `guiding` 并阻止重复点击或 turn 结束后的自动出队。
- Codex 纯文本队列项显示引导按钮；包含图片、文件正文、文件引用、附件元数据或仍在准备中的队列项不可引导。
- 当前运行等待问答/审批、正在中断、run ID 缺失或已结束时不可引导。
- method not found 等旧 CLI 拒绝必须保留原消息并给出明确错误；当前基础队列发送保持可用。

Out of scope:

- 不支持 steer 图片、上传附件、`@文件` 引用或其他非文本 content block。
- 不自动把 Codex 排队消息全部 steer；只有用户点击当前队列项才发送。
- 不接入原生 compact、fork、archive、review 或结构化 plan。
- 不改变 Claude Code 的 stdin guide，也不为 Grok、OpenCode、Pi 声明 steer 支持。
- 不新增 SQLite 字段；队列的 `guiding` / `guide-unknown` 是运行期状态。

## Data Flow

1. Composer 根据 Provider、active run、人机交互暂停状态和队列项内容决定按钮是否可用。
2. `useAgentRun.guideQueuedPrompt(promptId)` 重新校验目标 thread、run、Provider 和纯文本内容，将队列项置为 `guiding`。
3. 前端 POST `/api/agents/run/{runId}/guide`，body 只包含规范化后的非空 `prompt`。
4. `agent_run.rs` 通过 run record 的 control sender 发送 `AgentControlCommand::Guide` 并等待 acknowledgement。
5. `codex_app_server.rs` 在活动 turn 循环中读取真实 `turn_id`，发送 `turn/steer`：
   `threadId = provider thread ID`，`expectedTurnId = active turn ID`，`input = [{type: text, text}]`。
6. App Server 成功响应后 acknowledgement 为成功；明确 RPC error 为已知失败；响应未确认则 API 返回 `uncertain: true`。
7. 前端成功时出队并追加系统卡片；已知失败恢复 `ready`；不确定结果保留为 `guide-unknown`。

## Impact

- Backend protocol：`src-tauri/src/codex_app_server.rs` 增加 steer request tracking 和协议测试。
- Backend runtime：`src-tauri/src/agent_runtime.rs` 增加 Guide control variant；`src-tauri/src/agent_run.rs` 增加 API、ack 分类及非 Codex 拒绝。
- Frontend runtime：`src/hooks/useAgentRun.ts` 增加队列状态机、纯文本校验、成功卡片和错误处理。
- Frontend composition：`src/App.tsx` 让 Codex 复用现有 guide availability；`src/components/Composer.tsx` 展示 guiding/unknown 状态。
- Tests：扩展 Codex mock wire test、Agent API/control test和 `src/lib/queued-prompts.test.ts`。
- Persistence：不新增 schema；成功卡片随既有 turn history 持久化，未发送队列仍只存在运行期内存。

## Error Semantics

- `200 submitted=true`：App Server 已确认 steer，前端可以安全出队。
- `409 uncertain=false`：无活动 turn、非 Codex、method not found、expected turn 不匹配等明确拒绝，前端恢复 ready。
- `504 uncertain=true`：ack 超时；或控制接收端在确认前关闭，前端标记 unknown，禁止自动再发。
- 网络层异常：无法确认请求是否到达后端，按 unknown 处理，除非浏览器明确在发送前中止。
- `guide-unknown` 允许用户召回或删除，但不允许再次点击引导，也不在当前 run 完成后自动转为下一轮。

## Acceptance Criteria

- [x] Codex 运行中可把一条纯文本队列项 steer 到当前 turn，wire payload 使用真实 `threadId` 和 `expectedTurnId`。
- [x] steer 成功后队列项只移除一次，当前 turn 显示“已引导当前运行”，且 run 完成后不会再次自动发送。
- [x] 请求处理中不能重复点击，且恰逢 turn 结束时不会被下一轮自动取走。
- [x] 明确失败恢复 ready 并保留原消息；超时/断连标记 unknown 并阻止自动重发。
- [x] 无活动 turn、等待问答/审批、正在中断、非 Codex、附件或非文本 block 不会发起 steer。
- [x] 旧 Codex CLI method not found 时基础发送和下一轮队列仍可用。
- [x] Claude Code 现有 guide、Grok/OpenCode/Pi 队列和历史恢复无回归。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml codex`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run`
- `node --import tsx --test src/lib/queued-prompts.test.ts src/lib/multi-provider-chat-routing.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run build`
- `git diff --check`
- 桌面开发模式真实 Codex：运行长任务时排队纯文本并点击引导，确认当前轮响应吸收该消息；再验证附件禁用和失败保队。

## Implementation Record
- 2026-08-01T07:45:35.026Z 质量审查复核完成：限制仅队首且禁止并发 guiding；cancel 请求快照优先拒绝 steer；guide-unknown 冻结整队并在删除/召回最后一个 unknown 后恢复；terminal 后的 guide 成功不覆盖终态 activity。额外发现并修复 guide 成功后下一项仍 preparing 时 paused continuation 未清理的问题。

- 2026-08-01T07:44:32.549Z 真实桌面 Codex smoke：run b58f4859-ac30-4944-a245-3749b6986f09 的 /guide 返回 200 submitted=true，最终 done 同时包含 INITIAL_DONE 与 STEER_ACCEPTED，无 error 事件；工作目录为临时 smoke 项目，任务仅等待且未修改文件。
- 2026-08-01T07:44:20.803Z 完成 Codex turn/steer 跨层接入并根据独立代码质量审查修复竞态：仅队首可引导；取消 watch 已置位时拒绝 steer；guide-unknown 冻结整条队列且召回或删除最后一个 unknown 后恢复后续发送；terminal 先到时保留完成态 activity。非 Codex、附件和人工交互暂停仍保持拒绝。

- 2026-08-01T06:08:33.071Z Task created by Trellis automation.

## Verification Results
- 2026-08-01T07:46:07.670Z `desktop dev health and real Codex steer smoke`: 桌面壳于 15:39:51 重新编译；Web 5173=200，backend 3001 health 正常；真实 Codex guide=200 submitted=true，done 包含 INITIAL_DONE 与 STEER_ACCEPTED。UI 禁用状态由 39 项前端回归覆盖。

- 2026-08-01T07:45:57.940Z `git diff --check`: 通过；仅输出 Windows LF/CRLF 提示，无 whitespace error。
- 2026-08-01T07:45:54.652Z `git diff --check`: passed; only line-ending conversion notices

- 2026-08-01T07:45:53.942Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run`: 56 passed, 0 failed
- 2026-08-01T07:45:53.235Z `cargo test --manifest-path src-tauri/Cargo.toml codex`: 24 passed, 0 failed

- 2026-08-01T07:45:52.516Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed
- 2026-08-01T07:45:51.641Z `npm run build`: production build passed; only existing chunk and mixed-import warnings

- 2026-08-01T07:45:50.821Z `npm run typecheck`: tsc -b passed
- 2026-08-01T07:45:49.977Z `npx tsx --test src/lib/queued-prompts.test.ts src/lib/multi-provider-chat-routing.test.ts`: 40 tests passed, 0 failed

- 2026-08-01T07:45:47.055Z `npm run build`: 通过；Vite 2558 modules transformed，production build 完成，仅有既有 chunk size/dynamic import 警告。
- 2026-08-01T07:45:34.949Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。

- 2026-08-01T07:45:23.771Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run`: 56 passed, 0 failed；覆盖 guide API、ack 分类、非 Codex 拒绝及既有 Agent runtime。
- 2026-08-01T07:45:11.135Z `cargo test --manifest-path src-tauri/Cargo.toml codex`: 24 passed, 0 failed；包含真实 threadId/expectedTurnId wire、RPC known/unknown、取消与 guide 竞态测试。

- 2026-08-01T07:45:02.650Z `npm run typecheck`: 通过，TypeScript 0 错误。
- 2026-08-01T07:44:48.179Z `node --import tsx --test src/lib/queued-prompts.test.ts src/lib/multi-provider-chat-routing.test.ts`: 39 passed, 0 failed；覆盖队首约束、重复 guiding、unknown 整队冻结与解除、terminal activity 保护及多 Provider 路由。

## Completion Summary
- 2026-08-01T07:46:08.157Z 完成 Codex turn/steer 质量审查修复：限制队首/单一 guiding，消除 cancel/guide 竞态，guide-unknown 冻结及可恢复 continuation，保护 terminal activity，并补充 preparing 队首下的 stale continuation 清理。前端 40 tests、typecheck、build、Rust fmt、Codex 24 tests、agent_run 56 tests、diff check 全部通过；同一 session 的真实桌面 Codex steer smoke 已验证 `/guide` 200 且最终响应吸收 steer 内容。未提交或推送。

## Follow-ups

- P0-2 原生 compact 在本任务完成并真实验收后另开 Trellis session。
