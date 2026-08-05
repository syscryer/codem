# Task: Agent Mux 工作区运行与监控分组

## Background

Agent Hub 当前运行任务要求手动输入工作目录，运行监控则把所有记录平铺在同一列表。CodeM 已维护项目工作区列表，Agent Mux 运行记录也已持久化 `workingDirectory`，可以直接复用现有数据完成工作区选择与分组。

## Objective

运行任务仅选择 CodeM 现有工作区，运行监控按工作目录分组展示

## Scope

In scope:

- 将 CodeM `projects` 传入 Agent Hub。
- 运行任务只能从现有工作区中选择，默认当前工作区或第一个工作区。
- 运行监控按 `workingDirectory` 分组，匹配项目路径时显示项目名称和路径。
- 工作区分组默认展开，可单独收起或展开。
- 外部调用产生的非项目路径按目录名和实际路径分组；无路径旧记录归入“未关联工作区”。

Out of scope:

- 不新增自定义路径输入。
- 不新增工作区数据库字段或迁移。
- 不增加筛选和工作区管理功能，折叠状态不持久化。

## Impact

- Frontend: `src/App.tsx`、`src/components/AgentMuxPrototype.tsx`、Agent Mux 局部样式与测试。
- Backend/Persistence: 无变更，继续使用运行记录已有的 `workingDirectory`。

## Acceptance Criteria

- [x] 运行任务表单显示现有工作区下拉，不再显示工作目录文本输入框。
- [x] 没有工作区时无法开始运行，并明确显示“暂无工作区”。
- [x] 新运行使用所选项目的绝对路径作为 `workingDirectory`。
- [x] 运行监控按工作区展示分组标题、路径和记录数，组内运行记录保持原交互。
- [x] 每个工作区分组可以独立收起和展开，并提供正确的无障碍展开状态。
- [x] 外部路径和无路径旧记录仍可查看，不丢失历史记录。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/agent-mux-ui.test.ts`
- `npm run build`
- 桌面开发模式手工检查工作区下拉与监控分组。

## Implementation Record

- 2026-08-05T10:30:04.581Z 用户补充：运行监控工作区分组需要支持独立收起/展开；采用默认展开、本地 UI 状态、不持久化。
- 2026-08-05T10:25:17.203Z 确认采用方案 B：运行任务仅选择 CodeM 现有项目工作区；监控按 workingDirectory 静态分组；不新增自定义路径、数据库字段、折叠或筛选。

- 2026-08-05T10:23:58.290Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T10:39:24.836Z `Playwright 工作区场景`: 通过：CodeM 与 RunMux 两组正确展示；分组可收起；运行任务默认 CodeM 并可切换 RunMux。使用浏览器会话临时数据，未写数据库。
- 2026-08-05T10:39:07.112Z `npm run build`: 通过，Vite 生产构建完成；仅保留既有 chunk size 与动态导入提示。

- 2026-08-05T10:38:49.460Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: 通过，6 项 Agent Mux 回归测试全部通过，包含路径匹配、外部路径、旧记录和折叠语义。
- 2026-08-05T10:38:33.587Z `npm run typecheck`: 通过，TypeScript 项目构建无错误。

## Completion Summary
- 2026-08-05T10:39:43.546Z Agent Hub 已复用 CodeM 现有项目工作区：运行任务使用工作区下拉并传递项目绝对路径；运行监控按工作目录分组，支持独立收起展开，同时保留外部路径和无路径旧记录。类型检查、6 项测试、生产构建与 Playwright 场景验收通过。

## Follow-ups

- 暂无。
