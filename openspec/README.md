# OpenSpec（CodeM）

本目录用于沉淀 `CodeM` 的行为提案、交互变更和跨层能力调整说明。

当前先作为轻量占位入口使用，避免后续做功能演进时缺少统一提案位置。

## 适合放进 OpenSpec 的内容

- 新 provider 适配方案
- 项目 / 线程 / session 行为调整
- Claude stream event 展示策略调整
- 权限模式、模型切换、工作区管理等交互变更
- SQLite 结构或持久化行为变化

## 当前建议用法

当需求满足任一条件时，建议先写提案再改代码：

- 会改变用户可见行为
- 会改变 frontend / backend / persistence contract
- 会影响多个 provider
- 会引入新的配置模型或工作区语义

## 当前状态

- 目录已建立
- 还没有完整 OpenSpec CLI 工作流
- 现阶段可以先用 Markdown 文档做 proposal / decision record
