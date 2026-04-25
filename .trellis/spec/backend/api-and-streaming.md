# API And Streaming

## 核心原则

- frontend 只消费稳定 event contract
- backend 内部怎么调用 Claude Code CLI，可以演进；但 `/api/claude/run` 的事件语义不要轻易漂移

## 约束

- 新增 event type 时，必须同时检查 frontend `useClaudeRun`
- 修改现有 event 字段名时，必须列出受影响分支：
  - status
  - phase
  - delta
  - tool-start / tool-input-delta / tool-stop / tool-result
  - done / error

## done / error 规则

- terminal event 必须能明确结束一次 turn
- 没有 terminal event 的异常情况，frontend 应有兜底逻辑
- backend 不应把明显错误包装成正常 `done`

## Session 规则

- `sessionId` 只有在确认有效时才应持久化
- 无效 resume / stale transcript 需要可恢复，不能污染本地 thread metadata

## Conversation Timeline 规则

- streaming event、Claude JSONL transcript、SQLite stored history 应尽量生成一致的 turn timeline
- `request_user_input` / `ask_user_question` / approval 类 tool_use 不应只作为普通工具日志处理，它们需要保留可交互卡片语义
- 后端改 transcript parser 或 stored history 结构时，需要同步检查 frontend `Conversation Rendering Model`
