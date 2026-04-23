# Persistence Guidelines

## 当前持久化范围

- projects
- threads
- messages / turns
- tool calls
- selection
- panel state

## 更新原则

- metadata 更新和 history 更新要分开考虑
- thread 删除时，需要确认级联清理范围一致
- 本地 rename 只改 CodeM 自己的索引，不默认反写 Claude Code 源数据

## 风险点

- stale running state 持久化后，重新打开页面出现错误呼吸态
- invalid sessionId 被写回后，后续 resume 持续失败
- 删除 thread 后，残留 history / tool_calls

## 改动前检查

- 是否影响现有 SQLite schema
- 是否需要数据迁移
- 是否影响 frontend bootstrap payload
