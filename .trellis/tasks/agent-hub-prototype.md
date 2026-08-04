# Task: Agent Hub 可交互原型

## Background

CodeM 已具备多 Agent Provider、渠道、运行事件、使用统计与 Skills 管理基础。下一阶段计划将这些能力提升为 Agent Hub：由 CodeM 统一管理 Agent、Skill 路由及来自 CodeM/外部工具的调用记录。本任务先提供可交互前端原型，用于确认信息架构和核心交互，不代表真实执行能力已经接入。

## Objective

构建前端可交互原型，展示 Agent、Skill 路由和统一运行可视化，不接入真实后端

## Scope

In scope:

- 在现有侧边栏增加独立的 Agent Hub 原型入口。
- 提供 Agents、Skills、Runs 三个主视图。
- 使用本地 mock 数据展示 Agent 能力定位、供应商运行配置、健康与负载状态。
- 展示 Skill 的调用方权限、执行池、路由策略和发布目标。
- 展示 CodeM 内部调用与外部 Skill 调用的统一运行树、实时输出、用量和产物。
- 支持本地切换、选择、配置和模拟调用等原型交互。

Out of scope:

- 不新增或修改 Rust 后端 API、SQLite 表或 Agent 执行逻辑。
- 不真正生成、安装或调用外部 Skill。
- 不实现常驻服务、独立 CLI、工作流画布或复杂团队编排。
- 不持久化原型中的配置和模拟运行状态。

## Impact

- frontend：新增 Agent Hub 页面组件和样式，并接入 App 导航与侧边栏。
- backend / persistence：无影响。

## Acceptance Criteria

- [x] 侧边栏可进入 Agent Hub，浏览器前进/后退能正确恢复视图。
- [x] Agents、Skills、Runs 三个视图均有完整 mock 内容和空闲/运行/异常状态表达。
- [x] Skill 详情能区分允许调用方与实际执行池，并可切换路由策略和执行配置。
- [x] Runs 详情能展示调用来源、Skill、Agent/供应商节点、实时输出、用量和产物。
- [x] 原型在常规桌面宽度和窄桌面宽度下无主要内容重叠或横向溢出。
- [x] TypeScript 类型检查与前端构建通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 检查桌面与窄桌面视口下的三视图和关键交互。

## Implementation Record
- 2026-08-03T16:40:33.403Z Playwright 交互验收完成：验证侧边栏进入、浏览器前进后退恢复、三种路由策略切换、执行池成员启停、模拟调用进入 Runs，以及调用链/实时输出/产物展示。1440x900 与 960x720 均无整页横向溢出或主要内容重叠，截图保存在 C:\Users\syscr\AppData\Local\Temp\codem-agent-hub-qa。

- 2026-08-03T16:40:32.693Z React 质量检查完成：静态数据提升到模块级，筛选结果使用 useMemo，状态更新使用函数式 setState；当前原型无异步瀑布、额外全局监听或高成本列表渲染。
- 2026-08-03T16:40:31.952Z 完成 Agent Hub 前端原型：接入侧边栏与应用导航历史，新增 Agents、Skills、Runs 三视图；使用组件内 mock 数据展示 Agent 运行配置、Skill 调用权限/执行池/路由策略以及统一运行调用链、输出、用量和产物。未接入后端、持久化或真实 Agent 调用。

- 2026-08-03T16:20:28.758Z Task created by Trellis automation.

## Verification Results

- 2026-08-03T16:40:46.905Z `Playwright: Agent Hub navigation, routing/executor interactions, simulation to Runs, 1440x900 and 960x720 layout`: pass
- 2026-08-03T16:40:46.173Z `git diff --check`: pass

- 2026-08-03T16:40:45.368Z `npm run build`: pass
- 2026-08-03T16:40:44.612Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-03T16:40:59.261Z Agent Hub 可交互前端原型已完成并通过类型、构建和双视口交互验收；当前仅使用 mock 数据，真实 CLI、持久化与调用协议留待原型确认后拆分实现。

## Follow-ups

- 原型确认后再拆分 Agent/Skill/Run 持久化模型、独立 CLI 与真实调用协议任务。
