# State Management

## 状态分层

### 1. Local UI State

适合放在组件内部：

- menu open/close
- popover open/close
- 搜索框临时输入
- 点击外部关闭引用

### 2. Shared Workspace State

适合放在 `useWorkspaceState`：

- projects
- activeProjectId / activeThreadId
- threadDetails
- panelState
- dialogs / toast
- thread history 持久化

### 3. Runtime State

适合放在 `useClaudeRun`：

- prompt
- workspace
- permissionMode
- model
- isRunning
- backendRunId
- streaming event handling

### 4. Conversation Timeline State

聊天渲染相关状态需要遵守 `conversation-rendering-model.md`：

- `turn.items` 应逐步成为 assistant 侧内容的单一渲染来源
- AI 提问、审批、工具和文本都应按事件顺序进入 timeline
- `pendingUserInputRequests` / `pendingApprovalRequests` 可以作为待处理索引，但不应长期承担布局职责

## 边界规则

- `useWorkspaceState` 不要承接纯 UI 菜单开关
- `useClaudeRun` 不要关心 sidebar 的筛选和项目菜单
- 组件内状态不要反向污染全局 workspace state，除非它影响持久化或业务流程
- 热会话的 pending/running turn 不应被历史强刷覆盖
- 非热会话切换进入时应允许重新拉取历史，避免使用陈旧缓存

## 更新原则

- 状态更新优先保持单向依赖
- 避免 hook 之间互相持有对方内部状态
- 出现循环依赖征兆时，优先把纯桥接逻辑留在 `App.tsx`
