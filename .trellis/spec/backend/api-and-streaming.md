# API And Streaming

## 核心原则

- frontend 只消费稳定 event contract
- backend 内部怎么调用 Claude Code CLI，可以演进；但 `/api/claude/run` 的事件语义不要轻易漂移
- 热会话复用是优先路径；遇到人工输入节点时应先保留可写 runtime，通过 tool result 写回决策，只有 runtime 不可写时才用 `sessionId` 冷恢复

## 约束

- 新增 event type 时，必须同时检查 frontend `useClaudeRun`
- 修改现有 event 字段名时，必须列出受影响分支：
  - status
  - phase
  - delta
  - tool-start / tool-input-delta / tool-stop / tool-result
  - done / error
- 新增 Claude Code tool 语义映射时，必须同时检查 transcript parser、stored history 和实时 stream 三条路径

## done / error 规则

- terminal event 必须能明确结束一次 turn
- 没有 terminal event 的异常情况，frontend 应有兜底逻辑
- backend 不应把明显错误包装成正常 `done`
- 因 Plan、审批、AI 提问而暂停 runtime 时，不应把内部 tool_result 当成普通错误；如果必须结束当前 run，需要发送可区分原因，避免前端当成普通完整完成
- 权限拦截如果已经转成审批请求，不应再作为普通错误主导本轮终态

## Session 规则

- `sessionId` 只有在确认有效时才应持久化
- 无效 resume / stale transcript 需要可恢复，不能污染本地 thread metadata
- 暂停人工输入节点时保留已确认的 `sessionId`
- 用户后续批准、拒绝或补充输入时，应优先写入当前 stdin runtime；不可写时通过同一个 `sessionId` 冷恢复，而不是创建无关新会话

## 热会话 Runtime 规则

当前 Claude Code 后端桥接优先使用 `stdin + stream-json` runtime。

可复用条件：

- 同一 thread / session
- 同一 workspace
- 同一 permission mode
- 同一 model
- runtime 仍处于可写状态

必须暂停 runtime 的情况：

- `AskUserQuestion`
- `RequestUserInput`
- `ExitPlanMode`
- `ApprovalRequest`
- 权限型 `tool_result is_error`
- Claude Code 安全策略拦截，例如目录访问被拒绝

暂停处理：

- 发送对应的 `request-user-input` 或 `approval-request` event
- 对 `AskUserQuestion`、`RequestUserInput`、`ExitPlanMode`、`ApprovalRequest`，保留 runtime，等待用户决策后写入对应 tool result
- 已经转成卡片的内部 tool_result 不应再作为普通工具错误下发
- 权限型错误或安全策略拦截如果无法通过当前 runtime 继续，才结束当前 run 并回落到同 `sessionId` 续跑

## Conversation Timeline 规则

- streaming event、Claude JSONL transcript、SQLite stored history 应尽量生成一致的 turn timeline
- `request_user_input` / `ask_user_question` / approval 类 tool_use 不应只作为普通工具日志处理，它们需要保留可交互卡片语义
- 后端改 transcript parser 或 stored history 结构时，需要同步检查 frontend `Conversation Rendering Model`

## Tool 语义映射

### Plan

- `ExitPlanMode` 映射为 `approval-request`
- title 使用 `计划待确认`
- description 优先取计划内容
- danger 等级保持低风险语义

### 权限审批

- `ApprovalRequest` 映射为 `approval-request`
- `requires approval`、`requires your approval`、`approval required` 等错误结果也应映射为审批请求
- `was blocked` 且包含 `For security` / `Claude Code` 的安全拦截结果，也应映射为审批请求

### TodoWrite

- 后端不需要把 `TodoWrite` 预渲染成 UI 文案
- 只要保证工具输入和结果在实时、JSONL、SQLite 三条路径中可恢复
- 前端基于结构化内容派生计划卡片
