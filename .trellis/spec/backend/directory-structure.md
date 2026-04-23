# Backend Directory Structure

## 当前推荐结构

```text
server/
  index.ts
  lib/
```

## 放置规则

- `index.ts`
  - 只保留 server bootstrap、路由注册、少量粘合逻辑
- `lib/`
  - 放 Claude bridge、workspace store、stream parser、path/helper

## 推荐演进方向

后续如果 backend 继续变大，建议逐步演进为：

```text
server/
  index.ts
  routes/
  services/
  storage/
  lib/
```

但当前阶段不强制一次性迁移。
