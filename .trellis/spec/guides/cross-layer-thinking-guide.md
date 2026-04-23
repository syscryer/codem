# Cross-Layer Thinking Guide

出现以下任一情况时，必须做 cross-layer 检查：

- 改 frontend 对 Claude 事件的消费方式
- 改 backend 发出的 event 字段
- 改 thread / project / history 的持久化结构
- 改 workspace bootstrap payload

## 检查顺序

1. frontend 依赖哪些字段
2. backend 实际发哪些字段
3. 本地持久化记录哪些字段
4. 刷新页面后能否从 bootstrap/history 恢复一致状态

## 最低 DoD

- 已列出受影响文件
- 已确认 terminal event 路径
- 已确认刷新恢复路径
- 已跑 `npm run typecheck`
