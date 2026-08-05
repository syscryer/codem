# Task: Agent Mux 标准下拉统一

## Background

待补充背景。

## Objective

将 Agent Hub 新增原生下拉统一为 CodeM 标准自定义下拉，保留现有数据和联动行为

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record
- 2026-08-05T10:48:44.982Z 复用 CodeM settings-select 与 PopoverPortal，在 Agent Hub 内新增轻量 AgentMuxSelect，替换运行任务和运行配置抽屉中的全部 9 个原生下拉，并保留渠道/模型联动、禁用态和工作区选择逻辑。

- 2026-08-05T10:46:39.584Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T10:55:34.255Z `Playwright Agent Hub 下拉视觉验收`: 通过，添加配置与运行任务抽屉的标准下拉弹层、禁用态、选中态和 Escape 关闭正常；截图位于 output/playwright/agent-mux-standard-dropdowns.png 与 agent-mux-run-dropdowns.png
- 2026-08-05T10:55:25.371Z `npm run build`: 通过，Vite 生产构建完成；仅保留既有动态导入和大 chunk 警告

- 2026-08-05T10:55:17.108Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: 通过，7 项测试全部通过
- 2026-08-05T10:55:09.218Z `npm run typecheck`: 通过，TypeScript 无错误

## Completion Summary
- 2026-08-05T10:55:42.648Z Agent Hub 全部新增原生下拉已统一为 CodeM 标准主题下拉，复用现有 PopoverPortal 与 settings-select 样式，保留原有业务联动并完成类型、测试、构建和视觉验收。

## Follow-ups

- 待补充。
