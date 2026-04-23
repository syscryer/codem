# Conversation Runtime Upgrade

## Background

CodeM 目前已经具备基础对话能力：

- `stream-json` 流式消费
- tool step 内联展示
- thread 级 `sessionId` 记录与复用
- thread history 持久化与刷新恢复
- 停止当前运行
- 调试抽屉与 raw event 查看

但对照 `D:\project\desktop-cc-gui` 后，可以确认当前缺口主要集中在“对话运行态逻辑”，不是基础渲染能力。

这些缺口会直接影响：

- 刷新后恢复一致性
- 运行异常后的恢复体验
- 长会话可读性
- 交互型消息链路
- 多阶段 turn 生命周期稳定性

## Problem Statement

当前实现存在以下结构性不足：

1. 对话事件模型偏窄，无法表达 `request_user_input`、approval、runtime reconnect 等一等语义。
2. 运行断开后只能落成 error，缺少 recover / retry / resend 链路。
3. 自动滚动仍以“turn 变化即到底”为主，缺少用户手动阅读时的暂停跟随。
4. 长会话仍是全量渲染与简单滚动，缺少历史窗口、展开全部、滚动位置保护。
5. thread / session 生命周期处理仍然偏单线，缺少 pending thread 映射、stale event 忽略、中断后错误抑制等鲁棒性。
6. 对话层缺少专项测试，后续迭代容易回归。

## Goals

本次升级目标：

1. 把关键对话运行态能力升级为稳定 contract，而不是零散 UI 逻辑。
2. 优先补齐用户感知最强的链路：
   - 交互型输入请求
   - 运行断开恢复
   - 自动跟随与长会话体验
3. 为后续多 provider 演进保留清晰边界，避免把逻辑写死在 Claude-only 分支里。
4. 为刷新恢复、terminal event、history restore 提供统一语义。

## Non-Goals

本提案暂不覆盖：

- 全量照搬 `desktop-cc-gui` 的 message architecture
- 全新的全局状态库
- 推理内容完整可视化
- 多 provider 同时落地
- 桌面端壳能力或自动化能力

## Proposed Changes

### 1. Event Contract Upgrade

扩展 `/api/claude/run` 对应的前后端 contract，让 frontend 能把运行态事件当作业务语义消费，而不是只消费字符串和 terminal 状态。

优先新增的语义类型：

- `request-user-input`
- `approval-request`
- `runtime-reconnect-hint`
- `retryable-error`

要求：

- 新事件必须保持 stable shape
- terminal event 与非 terminal event 要明确区分
- 对 history restore 有意义的字段要能持久化或可重建
- `sessionId` 只在确认有效时持久化

### 2. Interactive Turn Flow

把“模型暂停等待用户补充输入”升级为一等消息流。

前端需要支持：

- 按 thread 维度展示待处理输入请求
- 选项题、文本补充、secret 输入
- 提交中状态与失败重试
- 请求完成后的 turn 更新

后端需要支持：

- 把相关 CLI / runtime 事件转成稳定消息
- 接收前端对请求的回应
- 将回应结果重新注入对应运行

### 3. Runtime Recovery Flow

把“运行出错”拆成两类：

- 普通错误
- 可恢复错误

可恢复错误需要支持：

- 识别 stale runtime / broken pipe / runtime ended 等 reconnect hint
- 从消息流中定位最近可重发的 user message
- 提供 recover / resend / retry 入口

这样可以解决“刷新后没完整读出”“运行半途断掉只能重新手打”的体验问题。

### 4. Live Scroll And Long History

把当前“turn 一变就滚到底”升级为“有状态的 live auto-follow”。

目标行为：

- 用户在底部附近时，继续自动跟随
- 用户向上浏览时，暂停自动跟随
- 提供明显的回到底部入口
- 切线程时重置 live 状态

长会话需要补：

- 默认历史窗口
- 展开全部历史
- 展开前后保持视口位置
- 选择文本时冻结列表更新
- 可选的 live middle steps 折叠

### 5. Thread Lifecycle Robustness

对话层要从“单次运行成功路径”升级到“线程生命周期管理”。

优先补的守护逻辑：

- pending thread -> finalized session 映射
- session 更新时 active thread 重绑定
- stale terminal event 忽略
- 用户手动 interrupt 后的错误抑制
- helper / internal thread 屏蔽

## Cross-Layer Impact

Frontend 主要影响：

- `src/types.ts`
- `src/hooks/useClaudeRun.ts`
- `src/hooks/useWorkspaceState.ts`
- `src/components/ConversationPane.tsx`
- 新增交互型消息组件与滚动控制逻辑

Backend 主要影响：

- `server/index.ts`
- `server/lib/claude-service.ts`
- 可能新增 request-response bridge / runtime recovery endpoint

Persistence 主要影响：

- thread metadata 中的 `sessionId` 写入条件
- thread history 可持久化 item 类型
- refresh 后的恢复一致性

## Delivery Plan

### Phase 1

先完成 event contract 扩展与前端状态承接。

交付结果：

- 新事件类型定义
- `useClaudeRun` 能正确消费并落状态
- terminal path / restore path 梳理完成

### Phase 2

补 interactive turn flow 与 runtime recovery 基础 UI。

交付结果：

- request-user-input 卡片
- recover / retry / resend 卡片
- 请求提交与失败回退

### Phase 3

补 live auto-follow 与长会话渲染控制。

交付结果：

- 自动跟随开关
- 历史窗口
- 展开历史后的滚动保护

### Phase 4

补线程生命周期鲁棒性。

交付结果：

- pending thread 映射
- stale event guard
- interrupt cleanup

### Phase 5

补对话层专项测试。

交付结果：

- user-input tests
- reconnect tests
- auto-follow tests
- lifecycle tests

## Definition Of Done

- 已列出受影响的 frontend / backend / persistence contract
- 已确认 terminal event 路径
- 已确认刷新恢复路径
- 新增对话行为有对应测试覆盖
- `npm run typecheck` 通过

## References

- Current repo: `D:\project\codem`
- Reference repo: `D:\project\desktop-cc-gui`
