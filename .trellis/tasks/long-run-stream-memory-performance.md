# Task: 优化超长 Agent 任务流式性能

## Background

用户反馈在 16 GB 内存机器上运行长时间、大型 Agent 任务时，聊天界面会逐渐卡死。现有优化已限制多轮历史的 DOM 挂载数量，并对文本 delta 和 debug 日志做了批处理，但单轮超长任务仍存在以下线性增长点：

- 每个 raw / phase 事件都可能刷新正在运行的 turn。
- Thinking、tool input 和 subagent 增量目前逐事件更新 React 状态。
- 工具结果频繁触发整段历史 JSON 序列化和持久化。
- Rust 运行记录保存每个 Claude `stream_event` 的完整 raw 副本，同时又保存归一化事件。

## Objective

在不改变聊天交互的前提下，批量处理高频时间线事件并限制运行事件缓存增长

## Scope

In scope:

- 运行中只在 run id 或 turn 状态真正变化时更新共享状态。
- 按动画帧合并 Thinking、tool input 和 subagent 的高频增量更新，并在工具结束、人工输入和 terminal event 前强制 flush。
- 为运行中的全量历史检查点增加最小间隔，terminal event 和人工交互节点仍立即持久化。
- Rust 仅对有调试价值的非 `stream_event` 输出 raw 事件，并去重连续相同的 phase 事件。
- 增加前后端定向回归测试。

Out of scope:

- 不引入第三方虚拟列表库。
- 不改变聊天布局、折叠方式、滚动语义和工具卡展示。
- 不修改 SQLite schema 或历史 API payload。
- 不对单轮工具步骤做强制隐藏或截断。
- 不修改普通聊天运行机制。

## Impact

- `src/hooks/useClaudeRun.ts`：Claude 实时事件调度。
- `src/hooks/useWorkspaceState.ts`：Agent 历史检查点调度。
- `src-tauri/src/backend.rs`：Claude 运行事件映射与内存保留。
- 不改变现有 frontend/backend event contract。

## Acceptance Criteria

- [x] 同一 run 的 raw 和重复 phase 事件不再产生无意义的 turn 状态更新。
- [x] Thinking、tool input 和 subagent 增量在一帧内只提交一次 turn 更新，顺序不丢失。
- [x] 工具结束、审批、AI 提问、done 和 error 前已经 flush 待处理增量。
- [x] 运行中历史检查点有最小写入间隔，terminal event 和人工交互节点不被延迟。
- [x] Claude token 级 `stream_event` 不再额外保存完整 raw payload，归一化文本/思考/工具事件仍可正常消费和重连。
- [x] 现有聊天布局、滚动、折叠和历史恢复测试不回归。

## Verification Commands

- `node --import tsx --test src/components/ConversationStreaming.render-perf.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record

- 2026-07-17T04:40:13.201Z 完成历史与后端减重：普通历史检查点限制为成功写入后至少间隔 10 秒，终态和人工交互立即持久化；Claude stream_event 不再保留完整 raw 副本，重复 phase 不再写入运行事件队列。
- 2026-07-17T04:40:05.566Z 完成前端流式调度优化：Claude thinking、tool input、subagent 增量按动画帧合并；共享状态跳过引用未变化的 thread/turn；结构事件前强制刷新待处理增量。

- 2026-07-17T04:21:01.646Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T04:40:46.287Z `npm run typecheck && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 全部通过；仅存在 Git 换行符提示，无差异错误。
- 2026-07-17T04:40:36.327Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 147 项通过，0 失败，1 项需真实 Grok 登录的烟测按设计忽略。

- 2026-07-17T04:40:29.602Z `node --import tsx --test src/components/ConversationStreaming.render-perf.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`: 通过：性能与历史持久化定向测试 7/7。
- 2026-07-17T04:40:21.620Z `node --import tsx --test src/**/*.test.ts src/**/*.test.tsx`: 通过：前端全量 515 项测试全部通过，0 失败。

## Completion Summary
- 2026-07-17T04:41:09.452Z 完成超长 Agent 任务性能优化：帧级合并高频结构增量，跳过无变化状态复制，普通历史检查点限频且关键状态立即写入，并减少 Claude raw/phase 运行事件缓存；前端 515 项、Rust 147 项及静态检查全部通过。

## Follow-ups

- 本轮不引入虚拟列表；如果后续真实超长单轮仍存在明显 DOM 压力，再基于性能采样单独评估单轮时间线虚拟化。
