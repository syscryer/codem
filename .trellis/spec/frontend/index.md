# Frontend 开发规范（CodeM）

本目录适用于 `CodeM` frontend，代码范围为 `src/**`。

## 技术基线

- React 19
- TypeScript strict mode
- Vite
- UI 以组件拆分 + hook 编排为主
- 目前未引入全局状态库，优先 `hook + local state + derived state`

## 规范目录

| 文档 | 用途 |
|---|---|
| [Directory Structure](./directory-structure.md) | frontend 文件落位和模块边界 |
| [Component Guidelines](./component-guidelines.md) | UI 组件职责、props、样式约束 |
| [State Management](./state-management.md) | local state / workspace state / runtime state 边界 |
| [Conversation Rendering Model](./conversation-rendering-model.md) | 聊天 timeline、热会话、AI 提问卡片和滚动行为约定 |
| [Quality Guidelines](./quality-guidelines.md) | 前端重构和改动的质量门禁 |

## Pre-Development Checklist

- 改 `App.tsx` 或页面骨架前，先看 [Directory Structure](./directory-structure.md)
- 新增或拆分 UI 组件前，先看 [Component Guidelines](./component-guidelines.md)
- 改 `hooks/`、菜单状态、对话状态、运行状态前，先看 [State Management](./state-management.md)
- 改聊天渲染、AI 提问卡片、历史刷新或滚动行为前，先看 [Conversation Rendering Model](./conversation-rendering-model.md)
- 做大文件拆分或跨组件重构前，先看 [Quality Guidelines](./quality-guidelines.md)
- 涉及 frontend -> backend contract 时，额外看 `../guides/cross-layer-thinking-guide.md`
