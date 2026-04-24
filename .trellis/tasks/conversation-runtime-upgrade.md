# Task: Conversation Runtime Upgrade

## Objective

按阶段补齐 CodeM 对话层缺失的关键运行态逻辑，优先解决：

- 交互型输入请求
- 运行断开恢复
- 自动跟随与长会话体验
- 线程生命周期鲁棒性

## Scope

涉及目录：

- `src/**`
- `server/**`
- 必要时更新持久化相关 schema / repository 逻辑

## Execution Order

### Stage 1. Event Model Foundation

目标：

- 明确新增事件类型与字段 shape
- 让 frontend 能消费新事件而不污染旧链路

待办：

- [ ] 盘点当前 `ClaudeEvent` 与实际后端流事件的映射缺口
- [ ] 设计 `request-user-input` / `approval-request` / `runtime-reconnect-hint` / `retryable-error` 的前端类型
- [ ] 梳理 history restore 是否需要新增 item 持久化形态
- [ ] 明确 `sessionId` 何时可写入 metadata，何时只能临时驻留

输出：

- `src/types.ts` 事件模型升级方案
- `server/**` event adapter 升级点清单

### Stage 2. Interactive Input Flow

目标：

- 支持模型请求用户补充输入的完整回路

待办：

- [ ] 设计 thread 级待处理输入请求队列状态
- [ ] 新增输入请求消息组件
- [ ] 支持单选、多选、文本补充、secret 输入
- [ ] 接入提交中、失败、成功后的状态回收
- [ ] 确认后端如何接收并恢复运行

验收：

- 当前 thread 出现输入请求时能稳定展示并提交
- 提交失败不会丢失草稿

### Stage 3. Runtime Recovery

目标：

- 区分普通错误与可恢复错误

待办：

- [ ] 识别 broken pipe / runtime ended / stale thread 等可恢复异常
- [ ] 为可恢复异常渲染 recover / resend / retry UI
- [ ] 从消息链路中定位最近一条可重发 user message
- [ ] 明确“重试当前 turn”和“重发上一条用户消息”的边界

验收：

- 模拟可恢复错误时，用户不需要手工复制 prompt 才能继续

### Stage 4. Live Scroll And History Window

目标：

- 提升长会话可读性与控制感

待办：

- [ ] 去掉 `turns` 变化即强制到底的默认行为
- [ ] 引入 near-bottom 检测与 live auto-follow 状态
- [ ] 保留并增强到底部按钮
- [ ] 增加默认历史窗口与“展开全部”
- [ ] 展开历史时保护滚动位置
- [ ] 评估是否加入 live middle steps 折叠

验收：

- 用户上滑阅读时不会被新消息强制拉回底部
- 长线程初次渲染性能与可读性提升

### Stage 5. Thread Lifecycle Guards

目标：

- 降低刷新、中断、session 绑定过程中的错乱概率

待办：

- [ ] 明确 pending thread id 与 finalized session id 的映射规则
- [ ] 处理 session 更新时 active thread 的重绑定
- [ ] 对 stale done / error 事件加防抖或忽略策略
- [ ] 用户手动停止后抑制冗余错误展示
- [ ] 排查是否存在 helper / internal thread 误入主对话的问题

验收：

- 新旧 turn 并发或 session 更新时，不会错误污染当前活动线程

### Stage 6. Tests And Verification

目标：

- 给核心对话行为建立回归保护

待办：

- [ ] 增加 `useClaudeRun` 相关事件消费测试
- [ ] 增加 user-input UI 行为测试
- [ ] 增加 reconnect / retry 行为测试
- [ ] 增加 auto-follow / history expansion 测试
- [ ] 增加 lifecycle / stale event 测试
- [ ] 跑 `npm run typecheck`

## Risks

- frontend 与 backend 事件 contract 漂移
- 历史持久化结构升级后刷新恢复不一致
- 新旧 thread/session 标识并存时出现误绑定
- 恢复链路过早落 UI，后端能力还未闭环

## Notes

- 优先按“先 contract、后交互、再滚动和鲁棒性”的顺序推进
- 不要求一次性复制参考项目的全部消息架构
- 每个阶段结束都要重新检查 terminal path 与 refresh restore path

## Completed 2026-04-24

- [x] 修复 history restore 覆盖本地新 turn：按 turn id 合并历史结果与当前本地 turns。
- [x] 修复空 `done` 成功态：空结果不追加文本，无可见输出时标记为 `stopped`。
- [x] 修复空 assistant 持久化：保存历史时只写非空 text item。
- [x] 修复 tool result 回挂与历史中孤立 `tool_result` 的展示错位。
- [x] 修复 Agent/Task 工具标题，使用任务描述作为可读摘要。
- [x] 过滤实时 `isSidechain` 事件，避免子 Agent 内部步骤污染主对话。
- [x] transcript 解析跳过 `isSidechain` / `isMeta`，并清理旧格式内部文本。
- [x] 会话列表收敛为 Claude jsonl 单一来源：已绑定 `session_id` 的线程必须有真实 jsonl 才展示。
- [x] 导入时跳过 `agent-*.jsonl` 子 Agent 文件。
- [x] 清理标题为 `1` 的历史 Claude Code 会话。
