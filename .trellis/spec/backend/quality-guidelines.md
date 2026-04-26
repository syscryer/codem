# Backend Quality Guidelines

## 基础门禁

```bash
npm run typecheck
```

改到后端运行时、路由或 Claude CLI 桥接时，需要重启本地 dev server 后再验证：

```bash
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

如果前端 dev server 也依赖本次改动，再确认 `http://127.0.0.1:5173` 可以正常打开。

## 检查项

- route 语义是否清晰
- payload 是否稳定
- streaming event 是否可被 frontend 明确消费
- 本地状态写入是否会留下脏数据
- resume / stop / delete 这类边界操作是否有兜底
- Plan / 审批 / AI 提问暂停点是否优先保留热 runtime，并在用户决策后写回对应 tool result
- 权限拦截是否会转成审批语义，而不是只落成红色错误
- 热会话复用条件是否同时比较 workspace、permissionMode、model 和 runtime 可写状态
- 修改 provider / model 读取逻辑后，是否考虑了运行中不强制切换、运行结束后同步的规则

## 禁止项

- 在多个地方重复拼同样的 Claude event 语义
- route 内直接堆复杂状态机逻辑
- 无验证地写入 sessionId、model、permissionMode
- 把 Plan / 审批 / AI 提问节点当成普通工具日志吞掉
- 在人工输入节点后把同一个结构化请求重复下发，或把已转成卡片的内部 tool_result 当普通错误展示
