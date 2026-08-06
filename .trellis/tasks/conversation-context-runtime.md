# Task: 会话上下文岛真实数据闭环

## Background

已确认的静态原型完成了信息层级和响应式布局。本阶段把原型接入 CodeM 已有真实数据与工作台动作，并保留 Agent Mux 关闭界面后独立运行的能力。

## Objective

当前会话能够实时看到 Git、计划、Agent 调用、输出文档和本地网址；所有入口复用现有工作台能力，刷新后保留显示偏好。

## Scope

In scope:

- 上下文岛只展示当前会话的上下文信息与运行状态摘要，保持只读，不承载审批、确认或提问处理。
- 当前项目的真实 Git 分支、变更统计、分支列表与切换。
- 打开变更审查、提交/推送、创建分支和 Git 历史现有界面。
- 当前会话最新 `TodoWrite` 计划。
- 与当前 CodeM thread 自动关联的 Agent Mux 运行记录，并实时刷新状态。
- 当前会话真实输出文档与 loopback 本地网址，复用现有文件预览、默认应用和浏览器工作台。
- 上下文岛显示模式本地持久化；无项目或无会话数据时不展示无关占位数据。

Out of scope:

- 不在上下文岛处理权限审批、Plan 确认、AI 提问或其他需要用户决策的交互；这些继续留在聊天时间线。
- 不新增工作流编辑、Agent 拖拽编排或新的 Agent 运行协议。
- 不读取或展示隐藏思维链、Runtime token、渠道密钥或大文件正文。
- 不为外部调用方猜测 CodeM 会话名称；只有继承到明确 thread id 时才精确关联。
- 不接入 Claude Code/Codex 自带子代理；本期“代理”仅指 Agent Mux 代理。

## Data Flow

- Git：`activeProject` + `useWorkspaceState` 现有 Git API。
- 计划/输出/网址：`activeThread.turns` 的结构化 timeline 与现有纯解析 helper。
- Agent Mux：现有 `/api/agent-mux/overview`；CodeM 主 Agent 进程继承 `CODEM_THREAD_ID`，CLI 创建 run 时写入可选 `threadId`。
- UI 偏好：仅保存显示模式到 `localStorage`，业务数据仍以 SQLite/API/timeline 为真相。

## Impact

- Frontend：上下文聚合 helper、实时 hook、上下文岛组件、`App.tsx`/`ConversationPane` 装配。
- Backend：Agent Mux run 可选 thread id、SQLite 增量列、主 Agent 子进程环境。
- CLI/Skill：Agent Mux CLI 自动读取继承的 thread id，不要求外部调用方新增参数。

## Acceptance Criteria

- [x] 当前项目 Git 信息与现有工作台一致，分支切换和入口可用。
- [x] 当前会话计划来自最新有效 `TodoWrite`，完成后自然隐藏。
- [x] Agent 区只展示当前会话真实 Agent Mux 调用，不混入原生子代理或静态数据。
- [x] CodeM 主 Agent 通过 Agent Mux 发起的调用能实时出现在当前会话；刷新后仍可恢复。
- [x] 输出文档和本地网址来自真实聊天内容，点击复用现有预览/打开流程。
- [x] 显示模式刷新后保持；无上下文时不展示静态假数据。
- [x] 宽屏、胶囊、窄屏入口和右侧工作台互斥行为保持不回归。
- [x] 前端、Rust、CLI、数据库迁移与桌面真实调用验收通过。
- [x] 上下文岛保持只读，只呈现上下文和状态；所有审批、确认与提问处理仍由聊天时间线承载。

## Verification Commands

- `node --import tsx --test src/lib/conversation-context.test.ts src/lib/conversation-context-integration.test.ts`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- Agent Mux CLI 真实调用 + 桌面宽屏/窄屏/工作台互斥验收。

## Implementation Record

- 2026-08-06T02:48:40.768Z 移除右侧工作台无功能的稍后添加工具加号按钮及对应样式。
- 2026-08-06T02:41:55.205Z 删除右侧工作台低价值概览标签与页面，默认切换为文件；上下文岛和聊天 Agent Mux 行改为可点击，直接打开右侧智能体详情；抽取复用现有 Agent Mux 聊天事件详情，并保留实时刷新、返回与取消运行。

- 2026-08-06T01:09:43.007Z 通过 codem-agent-mux 真实调用 OpenAI Codex/deepseek-v4-flash 对当前改动进行只读审查；独立复核确认外部 Agent 运行可能继承父进程残留 CODEM_THREAD_ID。根因修复位于 start_agent_run：始终显式设置该环境变量，无 threadId 时用空值覆盖继承值，有 threadId 时保留当前会话关联；不扩展原生子代理范围。
- 2026-08-05T19:03:27.159Z 完成会话上下文岛真实数据接入：仅展示当前 thread 关联的 Agent Mux 运行记录；Git、计划、输出文件、网址均复用现有真实数据与动作；CodeM 启动主 Agent 时注入 CODEM_THREAD_ID，Agent Mux CLI 写入可选 threadId，外部独立调用保持不变。

- 2026-08-05T18:26:18.475Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T02:48:41.452Z `npm run typecheck; node --import tsx --test src/lib/workbench-layout.test.ts src/lib/conversation-context-prototype.test.ts; git diff --check`: pass: typecheck, 18/18 targeted tests, and diff check passed
- 2026-08-06T02:42:05.973Z `node --import tsx --test src/lib/conversation-context-prototype.test.ts src/lib/agent-mux-ui.test.ts src/lib/workbench-layout.test.ts; npm run typecheck; npm run build; git diff --check; Playwright 5174 右侧工作台快照`: pass: 32/32 tests, typecheck/build/diff check passed; UI only shows 文件/审查/浏览器 and defaults to 文件

- 2026-08-06T01:10:00.000Z `Agent Mux 独立审查运行 mux-e947d00d-6d13-4b11-bc60-cebe14f08a34；cargo fmt --check；cargo test --bin codem-agent-mux inherited_thread_id_ignores_blank_values；cargo check --bin codem-backend --bin codem-agent-mux；git diff --check；桌面 Tauri 热重载`: 通过：审查任务 completed，发现的 1 个高置信会话隔离问题已修复；CLI 空值测试 1/1；Rust 编译 0 errors；diff 无空白错误；codem.exe 已在修复后自动重启。
- 2026-08-05T19:03:36.063Z `前端定向测试 19/19；Rust Agent Mux 测试 15/15；CLI thread id 测试 1/1；npm run build；cargo fmt --check；cargo check --bin codem-backend --bin codem-agent-mux；桌面宽屏/窄屏/工作台互斥 Playwright 验收；当前真实会话 Agent Mux 调用`: 全部通过；真实调用输出 CURRENT_THREAD_MUX_OK，记录仅出现在对应会话的上下文岛与聊天调用组，外部无 threadId 记录未混入。

## Completion Summary

- 2026-08-06T02:48:42.126Z 右侧工作台已移除无功能加号，保留文件、审查、浏览器和动态 Agent 详情入口。
- 2026-08-06T02:42:15.089Z 右侧工作台概览已移除；Agent Mux 调用可从上下文岛或聊天记录直达复用的详情侧栏，实时展示聊天解析输出并支持返回和取消运行。

- 2026-08-06T01:10:17.958Z 完成 Agent Mux 真实独立审查与修复：本期仍仅包含 Agent Mux 代理；外部运行现在不会因父进程残留 CODEM_THREAD_ID 被错误归入 CodeM 会话，显式关联调用保持原行为。Rust 检查、CLI 回归、diff 门禁及桌面热重载均通过。
- 2026-08-05T19:03:42.605Z 会话上下文岛已从静态原型升级为真实闭环：Git、计划、输出文件、网址和当前会话 Agent Mux 运行均接入真实数据；聊天底部同步展示 Agent Mux 调用；仅实现 Agent Mux 代理，不包含 Claude/Codex 原生子代理；真实桌面调用和自动化检查全部通过。

## Follow-ups

- 后续扩展只接入多来源计划、主 Agent/子 Agent 状态、验证结果、上下文占用、开发服务等只读摘要，不在岛内增加决策按钮。
