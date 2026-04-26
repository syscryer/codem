# Conversation Rendering Model

本文记录聊天历史、热会话和滚动行为的目标模型。修改 `ConversationPane`、`ConversationTurn`、`useClaudeRun`、`useWorkspaceState` 或后端 transcript parser 前，先按本文检查边界。

## 问题背景

当前聊天渲染同时依赖多组状态：

- `turn.items`
- `turn.tools`
- `turn.pendingUserInputRequests`
- `turn.pendingApprovalRequests`
- `threadDetails`
- streaming runtime state

这些状态来源不同：有些来自实时事件，有些来自 SQLite，有些来自 Claude JSONL transcript。连续小修时容易出现以下回归：

- 热会话切换后运行中的 turn 被历史覆盖
- 非热会话切回后历史不刷新
- AI 提问卡片被隐藏、错位或重复
- 内容高度变化后回到底部按钮不出现

## 目标原则

### 1. turn timeline 应是单一渲染来源

前端渲染应尽量只遍历 `turn.items`。所有 assistant 侧可见内容都应按事件顺序进入 timeline：

```ts
turn.items = [
  { type: 'text' },
  { type: 'tool' },
  { type: 'request-user-input' },
  { type: 'approval-request' },
  { type: 'text' },
];
```

`turn.tools` 可以保留为工具索引或兼容字段，但不应单独决定布局位置。

`pendingUserInputRequests` 和 `pendingApprovalRequests` 可以短期保留给“查找待处理请求”和提交流程使用，但不应作为尾部渲染列表。否则会和 `items` 顺序产生重复或错位。

### 2. AI 提问和审批是 timeline item

`request_user_input`、`ask_user_question`、`approval_request` 这类 Claude tool_use 不只是普通工具日志。它们在 UI 中是可交互卡片，应在解析阶段转成对应 item，并保留原始 tool id 作为提交锚点。

实时事件路径和历史解析路径必须生成一致结构：

- streaming event -> `turn.items`
- Claude JSONL transcript -> `turn.items`
- SQLite stored history -> `turn.items`

不要只在实时路径生成卡片，也不要只在前端渲染时猜测卡片应该挂在哪个 tool 下面。

Plan 相关规则：

- `ExitPlanMode` 在 UI 中按“计划待确认”审批处理，而不是普通工具错误
- Plan 卡片需要展示计划内容，批准后继续执行，拒绝后要求 Claude 调整计划
- Plan 批准不自动提升到完全访问权限

权限审批规则：

- 权限审批卡片优先于红色工具错误展示
- `requires approval`、`was blocked`、`For security`、`Claude Code` 等安全拦截结果应转成审批语义
- 已经转成审批卡片的工具结果不应在主对话中重复显示为普通错误

AI 提问规则：

- AI 提问卡片需要保留问题、选项、输入类型和原始 request id
- 提交后优先写回当前运行；不可写时才用补充 prompt 冷恢复当前 session
- 卡片提交状态和失败状态属于 runtime state，不应污染历史文本内容

### 3. TodoWrite 是计划卡片

`TodoWrite` 是当前任务计划的结构化来源，不应只按普通工具 JSON 展示。

对话流规则：

- `TodoWrite` 工具在原 turn 中渲染为计划任务卡片
- 顶部显示 `共 N 个任务，已经完成 M 个`
- 任务按编号展示
- 已完成项弱化，进行中项保持可读，未开始项正常展示
- 原始工具详情仍可作为调试信息保留，但主对话优先展示计划卡片

底部固定卡片规则：

- 输入框上方可以展示当前线程最新一条未完成 `TodoWrite`
- 固定卡片只是摘要，不改变原对话流
- 固定卡片只认最新一条 `TodoWrite`
- 最新计划全部完成后固定卡片自动隐藏
- 隐藏后不回退展示旧的未完成计划，避免用户看到过期任务

### 4. 热会话和冷历史边界

运行态是临时真相，持久化历史是长期真相。

- 正在跑的会话：以内存事件流为准，切走/切回不得用历史覆盖 pending/running turn。
- 非运行会话：切换进入时可以重新拉历史，以 transcript/SQLite 为准。
- 页面刷新后仍在跑：通过 active run reconnect 和事件 buffer 恢复。
- 运行结束后：保存完整 turn timeline，之后按普通历史读取。

人工输入节点是热会话的明确边界：

- Plan 确认、权限审批、AI 提问出现时，后端会暂停当前热 runtime
- 前端收到卡片后应把当前 turn 视为等待用户决策，并在运行仍可写时通过运行中接口提交决策
- 用户决策后优先继续同一 run；runtime 不可写时才由新的 run 使用同一 `sessionId` 冷恢复继续
- 这类暂停和冷恢复都是产品策略，不应被前端当成异常重试

历史合并时只能保留本地 live turn：

- `pending`
- `running`

普通 `done/error/stopped` turn 不应在强刷历史时继续粘回去，避免重复和陈旧内容。

### 5. 滚动只关心用户是否贴底

滚动逻辑不应理解 assistant item 类型。它只需要维护一个语义：

- 用户在底部附近：新内容自动跟随到底。
- 用户滚离底部：新内容不强制拉回，只显示回到底部按钮。
- 点击回到底部：滚到底，并恢复自动跟随。
- 打开旧会话：首次定位到底部。
- 切换会话：重置当前会话滚动策略。

新增卡片、工具预览或历史刷新后，必须重新测量 DOM 距离底部，否则按钮显隐会失真。

底部固定任务卡片和输入队列会改变 composer 区域高度。它们出现、消失或内容变化后，也必须触发滚动距离重新测量。

## 后续重构方向

建议以一次小重构统一模型，而不是继续叠局部补丁：

1. 扩展 `AssistantItem`，增加 `request-user-input` 和 `approval-request`。
2. `useClaudeRun` 收到对应 runtime event 时直接插入 item。
3. `parseClaudeTranscript` 和 stored history 读取也生成同样 item。
4. `ConversationTurn` 只按 `turn.items` 顺序渲染，移除尾部 request/approval fallback。
5. `pendingUserInputRequests` / `pendingApprovalRequests` 仅作为待处理索引，逐步由 item 派生。
6. 为关键路径补测试或浏览器脚本：
   - 切会话保留热会话输出
   - 非热会话切回刷新历史
   - AI 提问卡片只出现一次且位置正确
   - Plan 审批卡片批准 / 拒绝后不重复显示工具错误
   - 权限拦截结果能转成审批卡片
   - TodoWrite 固定卡片在全部完成后收起
   - 用户滚上去时新输出不自动拉回，回到底部按钮可见

## 修改前检查

- 是否同时覆盖实时事件、JSONL transcript、SQLite stored history 三条路径？
- 新增 item 是否有稳定 id，刷新后是否可复现？
- 是否会让 `pending/running` turn 被历史强刷覆盖？
- 是否会让已完成历史 turn 在强刷后重复出现？
- 内容高度变化后是否重新测量回到底部按钮？
- 如果改 `TodoWrite` 展示，是否同时检查了对话流卡片和底部固定卡片？
- 如果改审批或提问，是否确认了运行中写回和冷恢复兜底路径？
