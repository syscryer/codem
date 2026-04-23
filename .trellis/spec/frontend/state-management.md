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

## 边界规则

- `useWorkspaceState` 不要承接纯 UI 菜单开关
- `useClaudeRun` 不要关心 sidebar 的筛选和项目菜单
- 组件内状态不要反向污染全局 workspace state，除非它影响持久化或业务流程

## 更新原则

- 状态更新优先保持单向依赖
- 避免 hook 之间互相持有对方内部状态
- 出现循环依赖征兆时，优先把纯桥接逻辑留在 `App.tsx`
