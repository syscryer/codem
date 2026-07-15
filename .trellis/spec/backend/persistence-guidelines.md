# Persistence Guidelines

## 当前持久化范围

- projects
- threads
- messages / turns
- tool calls
- selection
- panel state
- Agent runtime metadata 与运行历史
- 普通聊天 provider / model / chat / message / tool call
- 普通知识库 source / chunk

## 更新原则

- metadata 更新和 history 更新要分开考虑
- rusqlite 多步写入需要事务保证一致性
- thread 删除时，需要确认级联清理范围一致
- 本地 rename 只改 CodeM 自己的索引，不默认反写 Claude Code 源数据
- 普通聊天和 Agent 使用独立表与运行机制，不通过可空字段混成同一模型

## 风险点

- stale running state 持久化后，重新打开页面出现错误呼吸态
- invalid sessionId 被写回后，后续 resume 持续失败
- 删除 thread 后，残留 history / tool_calls

## 改动前检查

- 是否影响现有 SQLite schema
- 是否需要数据迁移
- 是否影响 frontend bootstrap payload
- 是否会把 API Key、附件正文、base64 或思考原文写入历史/trace
