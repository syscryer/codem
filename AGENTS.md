# CodeM Agent Guide

本仓库当前使用轻量 `.trellis` 结构管理开发规范。

## 阅读顺序

开始较大改动前，建议按下面顺序建立上下文：

1. `README.md`
2. `.trellis/workflow.md`
3. `.trellis/spec/frontend/index.md`
4. `.trellis/spec/backend/index.md`
5. `.trellis/spec/guides/index.md`

## 当前约定

- frontend 代码范围：`src/**`
- backend 代码范围：`server/**`
- 类型与常量优先集中到 `src/types.ts`、`src/constants.ts`
- 纯 helper 优先放 `src/lib/**`
- 共享行为优先放 `src/hooks/**`
- 页面结构块优先放 `src/components/**`

## 任务与提案

- 开发任务沉淀目录：`.trellis/tasks/`
- 行为提案与变更说明目录：`openspec/`

## 当前阶段说明

仓库目前只启用了轻量规范骨架：

- 有规范文档
- 有任务目录
- 没有自动化脚本体系
- 没有 developer workspace / session record 流程

如果后续团队协作规模扩大，可以在当前骨架上继续补全。
