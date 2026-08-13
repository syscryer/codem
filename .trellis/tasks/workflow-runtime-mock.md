# Task: 工作流运行态 Mock

## Background

现有工作流 Mock 已覆盖管理卡片、React Flow 画布、多轮讨论配置和模拟推进，但尚未展示用户从主聊天触发工作流后如何查看整体进度、节点聊天日志和临时流程历史。真实执行接入前，需要先确认这条用户可见闭环。

## Objective

补齐聊天触发、运行卡片、节点日志、临时工作流历史和保存为正式工作流的前端 Mock 闭环

## Scope

In scope:

- 在工作流管理页增加“工作流 / 运行记录”双视图。
- 使用 Mock 数据同时展示正式工作流运行和临时工作流运行。
- 提供主聊天触发预览和紧凑的工作流运行卡片。
- 运行详情展示节点状态、聊天形式日志、补充指导、失败节点重试和取消。
- 临时工作流可保存为正式工作流，并出现在“我的工作流”列表。

Out of scope:

- 不修改真实聊天 timeline、消息协议或历史持久化。
- 不接 SQLite、工作流调度器和真实 Agent Mux 调用。
- 不实现条件判断、Worktree 隔离和应用重启恢复。

## Impact

- frontend：扩展 `src/lib/workflow-prototype.ts` Mock 数据与纯函数，调整 `src/components/WorkflowPrototype.tsx` 和局部样式。
- tests：补充临时运行历史和失败节点重试行为测试。
- backend / persistence：无影响。

## Acceptance Criteria

- [ ] 工作流页可在定义管理和统一运行记录间切换。
- [ ] 临时运行不出现在工作流卡片列表，但会出现在运行记录。
- [ ] 运行详情可逐节点查看聊天日志和运行状态。
- [ ] 失败节点可单独重试，成功节点状态保持不变。
- [ ] 临时运行可保存为正式工作流，且不会覆盖原运行记录。
- [ ] 窄窗口下运行详情不发生文字或操作重叠。

## Verification Commands

- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 1440x900 与 960x720 浏览器验收。

## Implementation Record
- 2026-08-12T07:25:38.513Z 完成工作流运行态 Mock：统一运行记录、主聊天触发预览、临时流程详情、节点聊天日志、补充指导、失败节点重试、取消运行和保存为正式工作流。正式与临时流程共用运行模型，临时流程不进入定义列表。

- 2026-08-12T06:46:08.743Z Task created by Trellis automation.

## Verification Results
- 2026-08-12T07:25:38.622Z `Playwright 1440x900 / 960x720`: 定义管理、运行历史、临时详情、失败重试和保存为工作流均通过；960px 无横向溢出并切换为上下布局。

- 2026-08-12T07:25:38.555Z `npm run typecheck && npm run build && git diff --check`: 类型检查、生产构建和差异格式检查通过；构建仅有既有 chunk/Tauri 动态导入警告。
- 2026-08-12T07:25:38.542Z `node --import tsx --test src/lib/workflow-prototype.test.ts`: 6 个测试全部通过，覆盖临时历史隔离和失败节点单独重试。

## Completion Summary
- 2026-08-12T07:25:50.173Z 完成工作流运行态前端 Mock 闭环：管理与运行双视图、聊天触发预览、临时历史、节点聊天日志、状态操作和保存为正式工作流；测试、类型检查、构建、差异检查及双尺寸浏览器验收通过。

## Follow-ups

- 交互确认后再接 SQLite、DAG 调度和真实 Agent Mux。
- 原“运行记录 + 节点列表详情”仅为前期 Mock，后续以 `workflow-instances-v1.md` 的“实例列表 + 只读实时画布 + 节点日志抽屉”为准。
