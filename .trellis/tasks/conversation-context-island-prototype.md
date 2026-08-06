# Task: 会话上下文岛与 Agent 调用原型

## Background

CodeM 已有聊天时间线、右侧工作台和 Agent Mux 管理页，但主聊天区还缺少一眼可见的会话上下文，以及区分 Agent Mux 执行 Agent 与 Claude Code/Codex 原生子代理的调用展示。本阶段先用静态数据验证信息层级和交互，不提前绑定运行协议。

## Objective

在 CodeM 聊天界面实现不接真实数据的 Agent 调用组和会话上下文岛原型

## Scope

In scope:

- 在主聊天时间线末尾展示静态 Agent 调用组。
- 在聊天区右上角展示静态会话上下文岛，包含 Git、Agent、输出文档和本地网址。
- 使用动物头像区分具体 Agent，并用供应商角标和标签区分 Agent Mux 与原生子代理。
- 支持上下文岛自动、始终展开、始终收起三种前端临时模式。
- 聊天区变窄时退化为状态胶囊或工具栏入口；右侧工作台打开时隐藏上下文岛。
- 完整上下文岛只占用聊天正文右侧的空白轨道，不悬浮覆盖正文内容。

Out of scope:

- 不接后端 API、SQLite、真实 Git、Agent 运行事件或文件输出数据。
- 不持久化展开模式，不实现拖拽、排序、工作流编辑或运行控制。
- 不改普通聊天、Agent Mux 管理页和现有聊天事件协议。

## Impact

- `src/App.tsx`：原型装配与临时显示状态。
- `src/components/ChatHeader.tsx`：窄屏上下文入口。
- `src/components/ConversationPane.tsx`：静态调用组挂载。
- `src/components/ConversationContextPrototype.tsx`：原型视图和局部交互。
- `src/styles.css` 与 `public/agent-avatar-sheet.png`：响应式样式和头像图集。

## Acceptance Criteria

- [ ] 主聊天区能看到 Agent Mux 与 Claude Code/Codex 原生子代理的静态调用层级。
- [ ] 上下文岛展示分支、修改统计、Agent、文档和本地网址静态信息。
- [ ] Agent Mux 和原生子代理在尺寸、缩进、标签和供应商角标上可区分。
- [ ] 自动模式在宽屏展开、中等宽度收起、窄屏隐藏并可从工具栏打开。
- [ ] 完整上下文岛仅在右侧空白轨道足够容纳时展开，不覆盖 820px 聊天正文。
- [ ] 打开右侧工作台时上下文岛不显示。
- [ ] 不产生任何新网络请求、后端调用或持久化写入。

## Verification Commands

- `node --import tsx --test src/lib/conversation-context-prototype.test.ts`
- `npm run typecheck`
- `npm run build`
- 桌面开发模式人工检查宽屏、窄屏、工作台展开和菜单切换。

## Implementation Record
- 2026-08-05T18:03:23.676Z 上下文岛静态原型增加 Git 工具三行、可搜索分支选择弹层与 5/6 计划进程；宽屏弹层位于岛左侧，窄屏保留原位。真实 Git 操作和计划数据仍未接入。

- 2026-08-05T17:55:56.541Z 按反馈修正为宽屏完整岛不改变正文中心；仅中屏手动展开时按缺少宽度动态让位。上下文信息增加分支、Agent、输出、浏览器分组，文档与网址改为一行一项。
- 2026-08-05T17:48:38.559Z 完整上下文岛展开时为聊天正文、任务条、输入框、回到底部按钮和底栏统一预留 356px 右侧轨道；胶囊和窄屏模式保持原布局。

- 2026-08-05T17:39:40.747Z 将右侧上下文岛宽度从 342px 收窄为 320px，窄屏弹出态同步；1920px 实测与正文间距 67px。
- 2026-08-05T17:38:18.244Z 将会话上下文岛和 Agent 调用组圆角由 8px 统一调整为 12px，并完成宽屏截图复查。

- 2026-08-05T17:29:16.016Z 调整上下文岛响应式轨道：1580px 以上完整展开，1180-1579px 显示胶囊，更窄改用工具栏入口，避免覆盖 820px 聊天正文。
- 2026-08-05T15:42:04.134Z 完成静态原型装配：新增会话上下文岛、聊天 Agent 调用组、窄屏工具栏入口和动物头像图集；数据全部位于前端组件内，未接 API 或持久化。

- 2026-08-05T15:31:39.556Z Task created by Trellis automation.

## Verification Results
- 2026-08-05T18:04:14.224Z `node --import tsx --test src/lib/conversation-context-prototype.test.ts && npm run build && git diff --check && Playwright 2048px Git/进程布局与分支弹层检查`: PASS：原型测试 6/6，TypeScript 与 Vite 构建通过，diff whitespace 检查通过；上下文岛高度 677px、进程 6 条、无横向滚动；宽屏分支弹层位于岛左侧且关闭后进程与 Agent 分组完整可见。

- 2026-08-05T17:56:34.950Z `node --import tsx --test src/lib/conversation-context-prototype.test.ts && npm run build && git diff --check && Playwright 2048/1600 布局检查`: PASS：原型测试 5/5，TypeScript 与 Vite 构建通过，diff whitespace 检查通过；2048px 完整岛下聊天中心 1174、输入框中心 1175；1600px 手动展开后输入框与底栏中心同为 810，和面板间距 42px，无横向滚动。
- 2026-08-05T17:40:12.757Z `Playwright 1920/1600/1440/780 响应式视觉与坐标检查`: PASS：1920px 完整 320px 面板位于正文右侧空白轨道，间距 67px；1600px 胶囊间距 55px；1440px/780px 使用工具栏入口且无横向滚动；右侧工作台打开时上下文岛卸载。

- 2026-08-05T17:40:01.886Z `node --import tsx --test src/lib/conversation-context-prototype.test.ts && npm run build && git diff --check`: PASS：原型测试 4/4，通过 TypeScript 与 Vite 生产构建，diff whitespace 检查通过；仅有既有大 chunk 与动态导入警告。
- 2026-08-05T16:02:43.899Z `桌面开发模式与 Playwright 视觉检查`: CodeM 桌面开发模式已运行；实际前端为 5174（5173 被其他项目占用）。已检查 1800px 展开、1440px 胶囊、780px 工具栏展开、右侧工作台隐藏、明暗主题，布局和头像均正常。

- 2026-08-05T16:02:25.356Z `npm run typecheck && npm run build`: 通过；Vite 构建成功，仅保留项目既有的大 chunk 与动态导入警告。
- 2026-08-05T16:02:07.551Z `node --import tsx --test src/lib/conversation-context-prototype.test.ts`: 3/3 通过：区分 Agent Mux/Claude/Codex 子代理，主聊天挂载与工作台隐藏成立，组件无请求调用。

## Completion Summary

- 2026-08-05T18:04:14.907Z 上下文岛原型补充 Git 工具、分支搜索弹层和计划进程：更改、当前分支、提交或推送各占一行，进程展示 5/6 完成度；保持静态前端原型，不执行真实 Git 或持久化操作。
- 2026-08-05T17:56:35.615Z 上下文岛布局完成 Codex 式校准：宽屏保持聊天正文居中，中屏仅在手动展开空间不足时动态让位；信息按分支、Agent、输出、浏览器分组，输出文档和本地预览各占一行。

- 2026-08-05T17:40:25.009Z 完成会话上下文岛右侧空白轨道布局：完整面板不覆盖正文，胶囊贴右，窄屏使用工具栏入口；面板宽度 320px，主要容器圆角 12px；测试、构建与多宽度视觉验收通过。
- 2026-08-05T16:02:58.657Z 完成不接真实数据的会话上下文岛与 Agent 调用组原型：支持动物头像、供应商角标、Agent Mux/原生子代理层级、响应式退化、三种显示模式和工作台互斥；已通过测试、类型检查、构建和桌面视觉验收。

## Follow-ups

- 后续确认原型后，再单独设计真实运行事件、上下文数据来源和持久化边界。
