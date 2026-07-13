# Task: 统一 Agent 厂商图标

## Background

Agent Provider 当前在输入区、Provider 菜单、设置页和会话列表中分别使用 Bot、终端、花括号等通用图标，无法直观看出 Claude、Grok 和 OpenAI Codex 的厂商归属，且各处映射逻辑重复。

## Objective

在所有 Agent 选择、配置和会话标识位置使用对应厂商品牌图标

## Scope

In scope:

- 提供统一的 Agent Provider 品牌图标组件。
- Claude Code 使用 Claude 标识，Grok Build 使用 Grok 标识，OpenAI Codex 使用 OpenAI 标识。
- CodeM Agent 使用 CodeM 自身应用图标，未知 Provider 使用通用 Agent 图标。
- 输入区、Provider 选择菜单、设置页 Provider 列表与详情统一复用该组件。

Out of scope:

- 不改变 Provider Registry、Agent 运行、模型选择和会话路由逻辑。
- 不把表示“Agent 与模型”功能分区或 Claude 子代理工具的通用图标改成某一家厂商图标。

## Impact

- `src/components/**` 的 Agent Provider 选择与配置图标渲染。
- `src/styles.css` 的品牌图标基础样式。
- `src/constants.ts` 补齐 CodeM Agent Provider 常量。

## Acceptance Criteria

- [ ] Claude Code、Grok Build、OpenAI Codex、CodeM Agent 在所有 Provider 配置入口显示正确品牌图标。
- [ ] 输入区当前 Provider 与展开菜单使用相同图标映射。
- [ ] 侧栏会话标题不再显示 Provider 小图标。
- [ ] 未知 Provider 仍有可用的通用图标。
- [ ] 图标在浅色和深色主题下均清晰，尺寸不改变现有布局。

## Verification Commands

- `npm run typecheck`
- 开发桌面模式下检查输入区、Provider 菜单、设置页和侧栏会话图标。

## Implementation Record
- 2026-07-13T04:51:18.423Z 新增共享 AgentProviderIcon，统一 Claude、Grok、OpenAI Codex、CodeM Agent 品牌标识；输入区与设置页均已接入，按用户反馈移除侧栏会话 Provider 小图标。

- 2026-07-13T04:24:18.073Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T04:52:38.402Z `git diff --check 与 git diff --cached --check`: 通过：未发现空白错误，仅有 Windows LF/CRLF 提示。

- 2026-07-13T04:52:03.880Z `Playwright 实际界面检查`: 通过：输入区触发器与菜单、Provider 设置列表与详情均显示正确厂商图标；浅色和深色主题清晰；侧栏会话小图标已移除。
- 2026-07-13T04:51:49.756Z `npm run typecheck`: 通过：TypeScript 项目检查无错误。

## Completion Summary
- 2026-07-13T04:52:52.848Z 完成 Agent Provider 品牌图标统一：选择与配置入口使用 Claude、Grok、OpenAI、CodeM 对应标识，未知 Provider 保留通用图标，侧栏会话 Provider 小图标按反馈移除。

## Follow-ups

- 无。
