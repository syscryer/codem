# Thinking Guides（CodeM）

这些指南用于减少重构期的“结构变漂亮，但系统更脆”的问题。

## 可用指南

| Guide | Purpose |
|---|---|
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | 保护 frontend / backend / persistence contract |
| [Refactor Guidelines](./refactor-guidelines.md) | 约束大文件拆分、hook 拆分、组件拆分 |
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | 避免 helper 和状态逻辑重复生长 |

## 触发信号

- 改 `useClaudeRun`、`useWorkspaceState`
- 改 `/api/claude/run` 事件结构
- 改 project/thread bootstrap payload
- 改聊天 timeline、AI 提问卡片、热会话恢复或历史刷新
- 大规模拆 `App.tsx`、`server/index.ts`
