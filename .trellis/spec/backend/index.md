# Backend 开发规范（CodeM）

本目录适用于 `src-tauri/src/**`。

## 技术基线

- Rust 2021
- Axum + Tokio
- rusqlite 本地持久化
- Tauri 2 桌面集成
- 主要职责：
  - 管理 workspace / project / thread
  - 封装 Claude Code、Codex、Grok Build、OpenCode 等 Agent bridge
  - 提供与 Agent 独立的普通 AI 聊天、MCP、Skills 和知识库
  - 提供 streaming API 给 frontend

## 规范目录

| 文档 | 用途 |
|---|---|
| [Directory Structure](./directory-structure.md) | Rust backend 模块落位 |
| [API And Streaming](./api-and-streaming.md) | REST + stream event contract |
| [Persistence Guidelines](./persistence-guidelines.md) | SQLite / 本地存储更新规则 |
| [Quality Guidelines](./quality-guidelines.md) | backend 改动的检查项 |

## Pre-Development Checklist

- 改 Agent/普通聊天运行接口或事件格式前，先看 [API And Streaming](./api-and-streaming.md)
- 改 thread / project / history 持久化前，先看 [Persistence Guidelines](./persistence-guidelines.md)
- 做 backend 重构前，先看 `../guides/cross-layer-thinking-guide.md`
