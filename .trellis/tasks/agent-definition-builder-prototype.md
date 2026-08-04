# Task: Agent 定义拖拽连线原型

## Background

Agent Hub 第一阶段已经提供 Agent、Skill 与 Runs 的只读/轻交互原型。当前 Agent 详情仍以列表方式展示能力与运行配置，无法直观看到 Agent、Skill 和供应商运行配置之间的组合关系。用户确认采用同页卡片编排方案，并要求同时加入具有业务语义的连线。

## Objective

在 Agent Hub 中实现同页卡片编排、拖拽、业务连线、检查器与保存取消交互

## Scope

In scope:

- 点击“编辑定义”进入占满 Agent Hub 工作区的编排模式。
- 左侧资源池提供能力、Skill 与当前 Agent 可用运行配置卡片，并支持拖入画布。
- 中央画布使用可拖拽节点卡片、缩放、平移、自动适配和连线表达定义关系。
- 连线约束为 Agent -> 能力、Agent -> Skill、Skill -> 运行配置，阻止无效或重复关系。
- 支持选中节点/连线后在右侧检查器编辑或删除，并支持画布节点删除。
- 支持取消、重置和保存；保存结果仅更新当前前端原型会话中的 Agent 定义。
- 兼容 CodeM 主题，并覆盖常规桌面与 960px 窄桌面布局。

Out of scope:

- 不接入后端 API、SQLite、真实 Skill 发布或 Agent 调用。
- 不实现多人协同、版本历史、撤销重做、自动布局或完整工作流引擎。
- 不允许任意无业务语义的自由连线。

## Impact

- frontend：新增 Agent 定义编排器组件、画布依赖和局部样式；调整 Agent Hub 原型的编辑状态与 mock 定义保存。
- backend / persistence：无影响。

## Acceptance Criteria

- [x] 点击“编辑定义”可进入同页编排器，取消后无修改退出。
- [x] 能力、Skill、运行配置卡片可从资源池拖入画布，已存在资源有明确状态且不能重复添加。
- [x] 节点可拖动，合法连线可以创建，无效/重复连线被拒绝并给出反馈。
- [x] 选中节点或连线后可在检查器查看、编辑或删除，画布状态同步更新。
- [x] 保存后返回 Agent 详情，并反映能力、Skill 和运行配置变更；刷新页面后恢复 mock 初始值。
- [x] 1440x900 与 960x720 下无主要内容重叠或整页横向溢出。
- [x] TypeScript 类型检查、生产构建和差异格式检查通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 验证进入编辑、拖入资源、创建/删除连线、保存/取消及双视口布局。

## Implementation Record
- 2026-08-03T17:39:51.512Z 本阶段仅保存到当前前端会话状态，刷新后恢复 mock 初始数据；不接后端、数据库、真实 Skill 发布或 Agent 调用。

- 2026-08-03T17:39:50.813Z 业务关系固定为 Agent -> 能力、Agent -> Skill、Skill -> 运行配置；保存前校验缺失、无效和重复关系，资源目录与已启用定义分离。
- 2026-08-03T17:39:50.154Z 编排器采用 MIT 许可的 @xyflow/react 12.11.2，并通过 React.lazy 按需加载；画布负责节点拖拽、缩放、平移、适配窗口和 MiniMap，避免自行维护复杂拓扑交互状态。

- 2026-08-03T16:56:41.779Z Task created by Trellis automation.

## Verification Results

- 2026-08-03T17:40:29.692Z `Playwright：进入/退出编辑；拖入资源；创建/删除合法连线；未连接节点与 Skill 缺少 Runtime 阻止保存；保存/取消语义；1440x900 与 960x720 响应式布局；控制台无 error/warning`: pass
- 2026-08-03T17:40:28.975Z `git diff --check`: pass

- 2026-08-03T17:40:28.209Z `npm run build`: pass
- 2026-08-03T17:40:27.527Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-03T17:40:55.389Z 完成 Agent Hub 同页拖拽连线编排原型：资源池、XYFlow 画布、业务连线约束、检查器、保存取消与双视口响应式验收均已落地；当前仅在前端会话内保存，后端持久化留待下一阶段。

## Follow-ups

- 原型确认后再设计持久化模型、版本控制、真实 Skill/运行配置来源和后端校验协议。
