# Task: Agent Mux 简化版可视化原型

## Background

上一版 Agent Hub 原型包含多个 mock Skill 和复杂画布，已经偏离当前“RunMux 增强版”的收敛方向。本阶段先以视觉原型明确 Agent Mux 的最小闭环：配置具体 Agent 及多模型运行配置、监控调用、生成唯一对外 Skill。

## Objective

将 Agent Hub 收敛为具体 Agent 配置、运行监控和唯一 Agent Mux Skill 导出原型

## Scope

In scope:

- 概览：主 Agent 调用、Agent 健康状态和唯一 Skill 入口。
- Agent Mux：按具体 Agent 工具配置多个供应商/模型运行配置。
- 可选能力等级、能力标签、用途、优先级和健康状态展示。
- 运行监控：调用方、目标 Agent、实际模型、状态和实时输出。
- 唯一 `codem-agent-mux` Skill 的预览、复制和导出入口。
- 桌面端与 960px 窄窗口视觉适配。

Out of scope:

- 不接真实 Agent 后台、供应商 API、持久化或外部 Skill 安装。
- 不实现多 Skill 目录、复杂工作流、拖拽画布和运行时路由状态机。
- 旧版 AgentDefinitionBuilder 仅保留源码，不接入本阶段页面。

## Impact

- frontend：新增 AgentMuxPrototype 展示层和局部主题样式，替换 Agent Hub 入口渲染。
- backend / persistence：无影响。

## Acceptance Criteria

- [x] 概览展示 Agent Mux 调用、健康状态和唯一 Skill 入口。
- [x] Agent 配置支持具体 Agent、多个供应商/模型组合及标签、能力等级展示。
- [x] 运行监控展示调用方、目标 Agent、实际运行配置和实时输出。
- [x] `codem-agent-mux` Skill 支持预览、复制反馈和导出入口。
- [x] 1440px 与 960px 宽度下无主要内容重叠。
- [x] TypeScript 类型检查、生产构建和差异格式检查通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 验证四个页签、复制反馈、控制台和 960px 布局。

## Implementation Record
- 2026-08-04T15:07:49.697Z 旧版 AgentHubPrototype 组件暂时保留但不再接入入口，避免影响之前的画布验收；本阶段仅替换 Agent Hub 展示层，不接真实后台或持久化。

- 2026-08-04T15:07:48.938Z Agent Hub Skill 收敛为唯一 codem-agent-mux，支持预览、复制配置、导出入口的视觉原型；Agent Mux 仅保留 Agent 配置和运行监控两条主线。
- 2026-08-04T15:07:48.241Z 新增简化版 Agent Mux 原型，Agent 类型按具体工具展示，运行配置支持同一 Agent 下多个供应商与模型，并展示可选能力等级、标签、用途和健康状态。

- 2026-08-04T14:50:54.303Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T15:07:52.595Z `Playwright：5175 端口打开 CodeM Agent Hub；概览、Agent Mux、运行监控、Agent Mux Skill 页签；复制 Skill 反馈；960x720 布局；控制台错误数为 0`: pass
- 2026-08-04T15:07:51.883Z `git diff --check`: pass

- 2026-08-04T15:07:51.165Z `npm run build`: pass
- 2026-08-04T15:07:50.423Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-04T15:09:35.136Z 完成 Agent Mux 简化版视觉原型：概览、具体 Agent 多模型配置、运行监控和唯一 codem-agent-mux Skill 复制/预览已落地；当前仍为 mock 展示，不接真实后台调用。

## Follow-ups

- 后续接入 Agent Mux 后台服务、真实配置持久化、Skill 文件导出和实际调用监控。
