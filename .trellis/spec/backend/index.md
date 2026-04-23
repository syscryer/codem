# Backend 开发规范（CodeM）

本目录适用于 `server/**`。

## 技术基线

- Node.js
- Express
- SQLite 本地持久化
- 主要职责：
  - 管理 workspace / project / thread
  - 封装 Claude Code CLI bridge
  - 提供 streaming API 给 frontend

## 规范目录

| 文档 | 用途 |
|---|---|
| [Directory Structure](./directory-structure.md) | server 模块落位 |
| [API And Streaming](./api-and-streaming.md) | REST + stream event contract |
| [Persistence Guidelines](./persistence-guidelines.md) | SQLite / 本地存储更新规则 |
| [Quality Guidelines](./quality-guidelines.md) | backend 改动的检查项 |

## Pre-Development Checklist

- 改 `/api/claude/run` 或事件格式前，先看 [API And Streaming](./api-and-streaming.md)
- 改 thread / project / history 持久化前，先看 [Persistence Guidelines](./persistence-guidelines.md)
- 做 service 重构前，先看 `../guides/cross-layer-thinking-guide.md`
