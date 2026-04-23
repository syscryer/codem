# Frontend Quality Guidelines

## 基础门禁

每次结构性改动后至少验证：

```bash
npm run typecheck
```

## 重构门禁

做组件拆分、hook 拆分、大文件整理时，需要确认：

- 行为没有被无意改变
- 新旧状态归属更清晰，而不是更绕
- `App.tsx` 在持续变薄，而不是把复杂度藏到更难找的位置
- 新增组件和 hook 的命名直观

## Review Checklist

- 是否存在无用 props 透传
- 是否把纯 UI 状态错误塞进共享 hook
- 是否把 `fetch`、streaming、持久化又带回组件层
- 是否引入了新的隐性耦合

## 禁止项

- 为了“看起来分层”而做过度抽象
- 一个 hook 同时管理 workspace、runtime、visual 三类状态
- 组件 props 出现过长的 setter 链或难以理解的回调组合
