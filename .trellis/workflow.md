# Trellis Workflow（CodeM 强制版）

本仓库的 `.trellis/` 是 CodeM 后续开发的强制项目管理入口。所有非纯问答、非临时排障的改动都必须先用这里的规范、任务记录和 session record 对齐。

## 当前目标

- 为 frontend `src/**` 提供拆分、状态、质量约束
- 为 backend `server/**` 提供 API、streaming、持久化约束
- 为跨层改动提供统一思考入口
- 为所有中长期任务沉淀 `.trellis/tasks/`
- 让需求边界、验收标准、实现记录、验证结果和遗留问题有唯一入口

## 硬性流程

1. 先判断任务类型：
   - 纯问答、命令查询、一次性排障说明：可以不建任务文件。
   - 小范围视觉、文案或已确认方案后的局部修正：可以不建任务文件，但必须遵守 `.trellis/spec/**`。
   - 新功能、行为调整、跨文件修复、跨层链路、性能/状态/数据流改动：必须启动 Trellis session，并创建或更新 `.trellis/tasks/<topic>.md`。
2. 开始实现前必须阅读相关规范：
   - frontend：`.trellis/spec/frontend/index.md`
   - backend：`.trellis/spec/backend/index.md`
   - 跨层：`.trellis/spec/guides/index.md`
3. 开始实现前启动或确认当前 session：
   - `npm run trellis -- start <topic> --title "任务标题" --objective "目标"`
   - 如果确实要替换未完成 session，必须显式使用 `--force`，并先确认旧 session 不再需要继续。
4. 任务文件至少记录：
   - 背景和目标
   - 需求边界和不做事项
   - 影响范围
   - 验收标准
   - 测试或验证命令
   - 实现记录和后续遗留
5. 实现过程中关键节点必须写入 session record：
   - `npm run trellis -- record "实现了什么或做出了什么决定"`
6. 验证后必须登记实际命令和结果：
   - `npm run trellis -- verify "验证命令" --result "结果摘要"`
7. 完成时必须写完成摘要，并清除当前 session 状态：
   - `npm run trellis -- complete --summary "完成摘要"`
8. 如果实现过程中发现范围扩大，先回到任务文件更新边界，再继续编码。
9. 完成后实际验证结果必须已经写回任务文件，不能只留在聊天里。

## 自动化能力

首版本地 CLI：

- `npm run trellis -- start <topic> --title "任务标题" --objective "目标"`：创建或复用任务文件，创建 session record，并写入当前 session 状态。
- `npm run trellis -- status`：查看当前活动 session。
- `npm run trellis -- record "内容"`：追加 session note，并同步写入任务实现记录。
- `npm run trellis -- verify "命令" --result "结果"`：追加验证记录，并同步写入任务验证结果。
- `npm run trellis -- complete --summary "摘要"`：写入完成摘要，并删除当前 session 状态。

当前仍未自动化的能力：

- developer 初始化脚本
- multi-agent orchestration
- workspace journal 自动生成

这些能力后续如果需要，可以在当前目录结构上增量补齐；缺少更高级自动化不代表可以绕开 Trellis 记录。

## 使用方式

1. 开始改动前，先看：
   - `./spec/frontend/index.md`
   - `./spec/backend/index.md`
   - `./spec/guides/index.md`
2. 涉及跨层链路时，额外看：
   - `./spec/guides/cross-layer-thinking-guide.md`
3. 涉及大规模拆分或重构时，额外看：
   - `./spec/guides/refactor-guidelines.md`
   - `./spec/guides/code-reuse-thinking-guide.md`
4. 新的中大型工作项必须通过 `npm run trellis -- start ...` 建立任务和 session record。
