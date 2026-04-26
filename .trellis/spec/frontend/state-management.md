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
- models
- isRunning
- backendRunId
- queuedPromptsByThreadId
- pending approval / user input submit state
- streaming event handling

### 4. Conversation Timeline State

聊天渲染相关状态需要遵守 `conversation-rendering-model.md`：

- `turn.items` 应逐步成为 assistant 侧内容的单一渲染来源
- AI 提问、审批、工具和文本都应按事件顺序进入 timeline
- `pendingUserInputRequests` / `pendingApprovalRequests` 可以作为待处理索引，但不应长期承担布局职责

### 5. Derived Dock State

输入框上方的当前任务固定卡片属于派生 UI。

- 来源是当前线程最新一条 `TodoWrite`
- 不单独持久化 dock 状态
- 不在 `useClaudeRun` 中维护第二份任务列表
- 任务全部完成后由派生逻辑自然返回空
- 如果后续需要折叠 / pin / dismiss，再单独设计用户级 UI state

## 边界规则

- `useWorkspaceState` 不要承接纯 UI 菜单开关
- `useClaudeRun` 不要关心 sidebar 的筛选和项目菜单
- 组件内状态不要反向污染全局 workspace state，除非它影响持久化或业务流程
- 热会话的 pending/running turn 不应被历史强刷覆盖
- 非热会话切换进入时应允许重新拉取历史，避免使用陈旧缓存
- 运行中的后续 prompt 队列按 thread id 隔离；删除队列项只影响未执行内容
- 权限菜单展示值只使用 `permissionMenuModes`，历史隐藏值需要回落到 `default`
- `model` 选择跟随当前线程；非运行线程切换时可以刷新模型列表
- 热会话运行中不要强制同步外部 provider 配置，避免改变当前运行

## 更新原则

- 状态更新优先保持单向依赖
- 避免 hook 之间互相持有对方内部状态
- 出现循环依赖征兆时，优先把纯桥接逻辑留在 `App.tsx`

## 当前关键流程

### 权限与模型

- `permissionModes` 保留 Claude Code 内部兼容值
- `permissionMenuModes` 是用户实际可见菜单值
- 保存线程元数据时可以保存真实权限值
- 展示触发器时如果不是可见权限值，回落到 `默认`
- `DEFAULT_MODEL_VALUE` 表示由后端读取当前 provider 默认模型

### 审批和提问

- 收到 `approval-request` 或 `request-user-input` 后，`turn.items` 插入对应卡片
- 对应 pending 索引用于查找和提交，不负责尾部布局
- 用户点击批准 / 拒绝后，前端应立即清理当前 pending 卡片的弹窗状态
- 后续继续执行通过新的 run 发起，不等待旧 stream 继续输出

### 后续需求队列

- 当前线程运行中再次发送 prompt 时，进入 `queuedPromptsByThreadId`
- 队列展示在 composer 内
- 队列项 id 用于删除，不能只按文本删除
- 当前 run 结束后按顺序取出队列继续执行
