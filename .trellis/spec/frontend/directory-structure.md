# Directory Structure

## 当前推荐结构

```text
src/
  components/
  hooks/
  lib/
  constants.ts
  types.ts
  App.tsx
```

## 放置规则

- `components/`
  - 只放可复用 UI 片段或页面结构块
  - 允许包含少量局部 UI state，例如菜单开关、popover 开关
- `hooks/`
  - 放跨组件可复用的行为逻辑
  - 典型例子：workspace 管理、Claude run 管理、outside dismiss
- `lib/`
  - 放纯函数、格式化函数、conversation helper、UI label helper
  - 尽量不放 React 依赖
- `constants.ts`
  - 放共享常量
- `types.ts`
  - 放跨组件共享类型

## 禁止项

- 不要把纯函数散落回 `App.tsx`
- 不要把远程请求和组件渲染强绑在同一文件里
- 不要新建名字过于泛化的文件，例如 `utils.ts`、`helper.ts`

## 推荐原则

- 优先按“职责”拆，不按“视觉块”盲拆
- 一个文件如果既含大段 JSX 又含复杂状态更新，优先拆出 hook 或 lib helper
