# Component Guidelines

## 组件职责

- `App.tsx` 负责页面装配和顶层桥接
- 页面中的大结构块优先拆成独立组件，例如：
  - `SidebarProjects`
  - `ChatHeader`
  - `ConversationPane`
  - `Composer`
  - `Dialogs`
  - `DebugDrawer`

## Props 约束

- 组件 props 尽量传“业务动作”，不要传整坨 state setter 组合
- 局部 UI 状态优先组件内管理，例如：
  - dropdown open/close
  - menu anchor ref
  - 点击外部关闭逻辑

## 样式约束

- 保持现有 Codex-like 白色桌面风格，不随意改视觉语言
- 结构重构时尽量不改 className，降低 CSS 回归风险
- 如果确实要改 className，必须同步检查 `styles.css`

## 何时拆组件

满足任一条件就应该拆：

- JSX 区块本身可独立理解
- 组件内部存在独立交互状态
- 同一块 UI 在 `App.tsx` 中占据明显篇幅
- 该块后续大概率继续迭代
