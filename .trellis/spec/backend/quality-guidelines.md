# Backend Quality Guidelines

## 基础门禁

```bash
npm run typecheck
```

## 检查项

- route 语义是否清晰
- payload 是否稳定
- streaming event 是否可被 frontend 明确消费
- 本地状态写入是否会留下脏数据
- resume / stop / delete 这类边界操作是否有兜底

## 禁止项

- 在多个地方重复拼同样的 Claude event 语义
- route 内直接堆复杂状态机逻辑
- 无验证地写入 sessionId、model、permissionMode
