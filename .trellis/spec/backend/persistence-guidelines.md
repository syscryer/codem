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
- Agent 线程的 `model` / `reasoning_effort` 保存当前快照；每个模型的思考偏好保存到 `thread_model_preferences`
- Provider 默认模型的偏好键固定为 `__default`，不能替换成运行时动态解析出的模型 id
- 创建线程时 provider、权限、模型、思考级别和首个模型偏好需要在同一事务中写入

## 风险点

- stale running state 持久化后，重新打开页面出现错误呼吸态
- invalid sessionId 被写回后，后续 resume 持续失败
- 删除 thread 后，残留 history / tool_calls

## 改动前检查

- 是否影响现有 SQLite schema
- 是否需要数据迁移
- 是否影响 frontend bootstrap payload
- 是否会把 API Key、附件正文、base64 或思考原文写入历史/trace
