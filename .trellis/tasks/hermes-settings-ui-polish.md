# Task: Hermes 设置页布局与信息分层优化

## Background

Hermes 已完成 Agent、档案、记忆、Skills、MCP、Gateway 与健康诊断的首轮接入，但设置页仍沿用通用 Provider 信息流：专属区域把状态、操作和结果混排在同一网格中，造成明显空白；CLI、Driver、命令、能力等运行信息又在面板下方铺开，页面层级松散且窄宽度下难以扫描。

## Objective

完整重构 Hermes 设置工作台的信息架构和视觉层级，将日常配置与运行诊断分离，同时保持现有 Hermes API 和聊天输入体验不变。

## Scope

In scope:

- 重构 Hermes 设置头部、状态摘要、一级标签和标签内容布局。
- 概览只承载关键健康状态、Agent 后端控制、诊断与安全审计。
- 档案、记忆、Skills、MCP、Gateway 使用一致的分区标题、列表、编辑器、空状态与操作反馈。
- 新增“运行信息”标签，集中展示 CLI、认证、Driver、可执行文件、配置目录、生命周期命令、诊断状态、Provider 能力和模型信息。
- Hermes 不再在专属面板下方重复渲染通用 Provider facts、能力和模型区域。
- 补齐初始加载、刷新、错误、空数据、忙碌禁用和窄宽度响应式状态。
- 使用现有主题变量、Lucide 图标和 CodeM 通用按钮/列表样式，兼容浅色与深色主题。

Out of scope:

- 不修改 Hermes 后端 API、数据协议和 Agent 运行逻辑。
- 不修改聊天输入框、自适应布局或会话页面行为。
- 不改变其他 Agent Provider 的设置结构与交互。
- 不新增 UI 组件库或持久化新的全局设计系统文件。

## Impact

- 前端：`HermesSettingsPanel`、Hermes 在 `AgentProviderSettings` 中的组合方式、相关主题样式。
- 测试：Provider 管理 UI 源码契约测试。
- 安全/隐私：不新增敏感数据采集；命令与路径沿用既有只读展示和复制行为。
- 兼容：保持现有 API 调用和数据形状，其他 Provider 继续走原通用页面。

## Acceptance Criteria

- [ ] Hermes 顶部状态、标题和刷新入口紧凑对齐，不再出现截图中的大块空白。
- [ ] 七个一级标签在宽屏与窄屏均可完整访问，当前标签有清晰视觉和无障碍状态。
- [ ] CLI、Driver、路径、命令、诊断、能力和模型只在“运行信息”标签出现一次。
- [ ] 概览的状态摘要与操作栏各自成组，操作结果不会挤占摘要网格。
- [ ] 档案、记忆、Skills、MCP、Gateway 的表单具有可见标签，异步操作有加载/禁用反馈，空数据不显示空白区域。
- [ ] 375px、768px、1024px 和桌面宽度下无横向溢出或文字遮挡。
- [ ] 深浅主题均复用现有语义变量，焦点、悬浮、禁用和危险操作状态可辨识。
- [ ] Hermes 之外的 Provider UI 行为不变，聊天输入框相关文件无改动。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`
- `npm run build`
- `git diff --check`
- 桌面开发页在 375px、768px、1024px 与宽屏视口完成截图检查。

## Implementation Record
- 2026-08-10T04:03:09.901Z Hermes UI complete: split runtime details into dedicated tab, restructured overview/profiles/memory/skills/MCP/gateway, added loading/error/empty states and container-query responsive layout; chat input untouched.

- 2026-08-10T03:19:52.189Z Task created by Trellis automation.

## Verification Results

## Completion Summary

- 2026-08-10T04:03:09.947Z Hermes settings UI restructured and verified
- 2026-08-10T03:59:38.758Z Hermes settings UI restructured

## Follow-ups

- 如后续 Hermes API 增加档案创建/删除或 Gateway 平台编辑能力，再在对应标签内扩展，不提前增加占位入口。
