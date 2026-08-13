# Task: 工作流画布 Mock 原型

## Background

CodeM 已经有 Agent Mux 配置、运行监控，以及基于 `@xyflow/react` 的 Agent 定义画布，但尚未提供面向用户的工作流编辑入口。用户希望首版保持轻量：允许用户拖拽编辑流程，内置常用模板，并把 Agent 间多轮讨论作为一个可配置节点；本阶段先用前端 Mock 数据验证信息架构和交互，不接真实调度。

## Objective

在 Agent Hub 中实现可拖拽、可连线、可配置的工作流编辑原型，使用 Mock 数据展示多轮讨论流程，不接真实执行后端

## Scope

In scope:

- 在当前实际挂载的 Agent Hub 中增加“工作流”标签页。
- 提供三套 Mock 工作流模板，并允许切换后复制为当前原型草稿。
- 复用现有 `@xyflow/react` 能力，支持从节点库点击或拖入节点、移动节点、创建连线、选择和删除节点/连线。
- 节点至少覆盖开始、Agent 任务、多轮讨论、人工确认和结束。
- 多轮讨论节点允许配置提案 Agent、审查 Agent、满意条件、最大轮数；默认最多 10 轮，达到上限后等待用户处理。
- 右侧检查器可编辑节点名称、任务说明和对应配置；画布展示 Mock 运行状态与当前讨论轮次。
- 使用 CodeM 现有主题变量、Lucide 图标和统一下拉组件，兼容常规桌面与窄桌面布局。

Out of scope:

- 不接入后端 API、SQLite、Agent Mux 真实执行、会话恢复或持久化。
- 不实现 Orca 式邮箱、心跳、复杂消息总线、并行调度、版本历史、撤销重做和自动布局。
- 不保存真实提示词、凭据、API Key 或 Agent 输出；刷新页面后恢复 Mock 初始数据。

## Impact

- frontend：新增工作流原型组件、Mock 数据、画布节点和局部样式；调整 Agent Hub 标签页。
- backend / persistence / privacy：无影响，不新增网络请求或持久化数据。

## Acceptance Criteria

- [x] 当前 Agent Hub 可直接进入“工作流”标签页，页面使用 Mock 数据且明确标识。
- [x] 用户可切换内置模板，并看到画布节点、连线和右侧配置同步变化。
- [x] 节点可点击或拖入画布、移动、连线、选中和删除；非法重复连线被阻止。
- [x] 多轮讨论节点可配置 A/B Agent、最大轮数和满意条件，画布明确显示“满意则结束，否则继续”和达到上限后的用户介入边界。
- [x] 原型支持保存草稿和模拟运行反馈，但不产生后端请求或持久化副作用。
- [x] 1440x900 与窄桌面视口下无主要内容重叠或整页横向溢出。
- [x] TypeScript 类型检查、生产构建、针对性测试和差异格式检查通过。

## Verification Commands

- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 验证模板切换、节点拖入、配置编辑、模拟运行和双视口布局。

## Implementation Record
- 2026-08-11T17:27:36.261Z 2026-08-12 浏览器验收已覆盖 Agent Hub -> 工作流、模板切换、节点拖入、模拟运行以及 1440x900/960x720 视口布局；未见主要内容重叠或整页横向溢出。

- 2026-08-11T17:27:35.566Z 2026-08-12 已完成工作流画布 Mock 原型：在 Agent Hub 新增工作流标签，提供方案评审、代码交付、问题诊断三套模板；支持节点库点击/拖拽添加、移动、连线、选中、删除、模板切换、右侧节点检查器及多轮讨论参数配置。模拟运行仅更新运行态，不再将草稿标记为 dirty；全程不发起后端请求或持久化。
- 2026-08-11T17:09:12.919Z 已确认当前 Agent Hub 实际挂载 AgentMuxPrototype；工作流原型以独立懒加载标签页接入，复用现有 @xyflow/react、主题变量、资源池与检查器交互，不接后端或持久化。

- 2026-08-11T16:59:53.830Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T17:27:40.047Z `Playwright：1440x900、960x720；模板切换、节点拖入、模拟运行`: 通过

- 2026-08-11T17:27:39.243Z `git diff --check`: 通过
- 2026-08-11T17:27:38.484Z `npm run build`: 通过；仅有既有分包体积与 Tauri 动态导入提示

- 2026-08-11T17:27:37.756Z `npm run typecheck`: 通过
- 2026-08-11T17:27:36.996Z `node --import tsx --test src/lib/workflow-prototype.test.ts`: 3 项测试通过

## Completion Summary
- 2026-08-11T17:27:46.235Z 工作流画布 Mock 原型已完成并通过类型检查、生产构建、针对性测试、差异检查和浏览器双视口验收；当前不接后端、不持久化，等待用户确认交互后再进入真实调度设计。

## Follow-ups

- 原型确认后再设计工作流持久化、执行状态机、Agent Mux 会话复用、失败恢复和真实多轮通讯协议。
