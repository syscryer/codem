# Code Reuse Thinking Guide

当同类逻辑已经出现 2 次以上时，优先考虑复用。

## 适用场景

- 多个组件都在做菜单外部点击关闭
- 多处都在做 label 格式化
- 多处都在消费同一类 Claude event
- 多处都在做 thread/project 选择后的清理逻辑

## 复用位置建议

- 纯函数：`src/lib/`
- React 行为：`src/hooks/`
- 视觉结构：`src/components/`

## 不要为了复用而复用

- 如果抽出来反而让阅读路径更长，不如先保持局部实现
- 如果一个 helper 只有一个调用点且不复杂，可以暂不抽
