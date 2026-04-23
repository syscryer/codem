# Trellis Workflow（CodeM 轻量版）

本仓库的 `.trellis/` 先采用轻量模式，目标是给 `CodeM` 提供稳定的开发约束，而不是一开始就引入完整脚本体系。

## 当前目标

- 为 frontend `src/**` 提供拆分、状态、质量约束
- 为 backend `server/**` 提供 API、streaming、持久化约束
- 为跨层改动提供统一思考入口
- 为后续任务沉淀保留 `.trellis/tasks/`

## 当前不包含

- developer 初始化脚本
- session record 自动化
- task CLI / multi-agent orchestration
- workspace journal 自动生成

这些能力后续如果需要，可以在当前目录结构上增量补齐。

## 建议使用方式

1. 开始较大改动前，先看：
   - `./spec/frontend/index.md`
   - `./spec/backend/index.md`
   - `./spec/guides/index.md`
2. 涉及跨层链路时，额外看：
   - `./spec/guides/cross-layer-thinking-guide.md`
3. 涉及大规模拆分或重构时，额外看：
   - `./spec/guides/refactor-guidelines.md`
   - `./spec/guides/code-reuse-thinking-guide.md`
4. 新的中大型工作项可以在 `./tasks/` 下建目录沉淀 PRD、检查项、实现记录。
