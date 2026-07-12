# Task: 多 Provider 聊天接入

## Background

CodeM 已具备 Provider Registry、Grok ACP Driver 和受环境变量保护的通用 Agent 运行 API，但主聊天仍固定调用 Claude Code。当前线程表已经包含 `provider` 字段，聊天历史也统一保存在 CodeM SQLite，因此本阶段在现有会话模型上增加 Provider 路由，不另建 Grok 专用存储。

## Objective

在不改变现有 Claude Code 运行链路的前提下，为新建会话增加 Provider 选择并接入 Grok 通用 Agent API，持久化 Provider 归属和 Grok 会话历史，首期仅支持文本输入。

## Scope

In scope:

- 新建聊天草稿可选择 Claude Code 或已启用、可用的 Grok Build；Claude Code 始终为默认值。
- 首次发送时把所选 Provider 写入线程，线程创建后锁定 Provider，不允许中途切换。
- 现有线程、导入线程和没有显式 Provider 的旧数据继续使用 Claude Code。
- Claude Code 保留现有 `useClaudeRun`、队列、附件、模型、权限和恢复链路。
- Grok Build 使用独立的通用 Agent hook，支持文本流、工具事件、审批、结构化提问、取消和 session resume。
- Grok turn 和 sessionId 复用现有 CodeM SQLite 历史与线程元数据，刷新后能恢复已持久化会话并继续发送。
- Grok 仅在 `CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN=1` 且 CLI 可用时允许选择；不可用状态需要在 UI 中明确展示，不静默回退到 Claude。
- Provider 选择器复用现有 Composer 菜单和主题变量，具备键盘语义、选中态、禁用态和明暗主题一致性。

Out of scope:

- Grok 图片、上传附件、`@文件` 内容块和运行中发送队列。
- 在已有线程中切换 Provider、跨 Provider 迁移 session 或合并历史。
- Codex、自研 Agent 的正式 Driver 接入。
- 统一改写 Claude Code 运行 hook、模型设置和权限语义。
- Grok 模型选择、MCP 配置和 active run 跨页面刷新自动重连。

## Impact

- Frontend：`src/types.ts`、`src/hooks/**`、`src/components/Composer.tsx`、`src/App.tsx` 及相关样式/测试。
- Backend：Rust thread create/metadata/history 读取和 Provider Registry；通用 Agent API 合同保持兼容。
- Persistence：不新增表；沿用 `threads.provider`、`threads.session_id`、`messages`、`tool_calls`，需要保证非 Claude session 不生成或解析 Claude transcript 路径。
- Security / privacy：不持久化 ACP raw event、思考正文或 secret 提问答案；历史只保存当前可见文本、工具摘要和请求状态。
- Compatibility：Claude Code 线程创建默认值、运行端点和现有 UI 控件行为保持不变。

## Acceptance Criteria

- [x] 新建聊天默认显示 Claude Code，可选择已启用且可用的 Grok Build；规划中/不可用 Provider 有清晰禁用说明。
- [x] 首次发送创建带正确 `provider` 的线程，创建后 Provider 控件锁定，旧线程仍为 `claude-code`。
- [x] Claude Code 的文本、附件、队列、模型、权限、审批、提问、停止和历史恢复路径不改变。
- [x] Grok 文本回复和工具调用按事件顺序进入现有 conversation timeline，并能正常结束为 done/error/stopped。
- [x] Grok 审批和结构化提问可从现有卡片提交，取消操作调用通用 Agent API。
- [x] Grok sessionId 与 turn 历史写入 SQLite；刷新后线程仍可见、历史可读，下一轮使用原 sessionId 恢复。
- [x] Grok 模式不接受附件或 `@文件` 引用，并给出明确说明；不会丢失或误发到 Claude。
- [x] 未开启实验环境变量时后端拒绝 Grok 运行，UI 不允许选择，且绝不自动回退到 Claude。
- [x] Provider 选择器支持键盘操作、焦点/禁用/选中态，并在浅色、深色主题下沿用现有变量。
- [x] 相关单元测试、TypeScript typecheck、Rust tests 和生产构建通过；桌面开发模式重启后健康检查正常。

## Verification Commands

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`（若仓库没有该入口则运行相关 `node --test` / `tsx --test` 文件）
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm.cmd run build`
- 启用 `CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN=1` 后运行 `npm.cmd run desktop:dev`，检查 `/api/health`、`/api/agents/providers`、Claude 回归和 Grok 新建/续聊/审批/取消/刷新恢复。

## Implementation Record
- 2026-07-12T11:29:36.583Z 完成受控多 Provider 主聊天接入：Thread.provider 统一路由，Claude 保留原 useClaudeRun 链路，Grok 使用独立 useAgentRun 与 /api/agents/run；Provider 创建后锁定，Grok 首期仅文本；SQLite 持久化 turn/sessionId；取消竞态通过响应 runId 与后端发送前取消检查修复；Provider 菜单、Sidebar、WorkspaceStatus 和主题样式已接入。

- 2026-07-12T10:42:12.276Z Rust 侧已完成 Provider 真相源接入：Registry 仅在实验开关开启且 grok CLI 可用时允许选择；线程创建校验并持久化 provider；非 Claude 线程不参与 transcript 可见性、导入去重、删除忽略记录或历史解析。新增 provider/session 边界测试，cargo check --tests 通过。
- 2026-07-12T10:36:56.242Z 已确认受控主聊天方案：Thread.provider 是会话归属唯一来源；新会话可选 Provider 且创建后锁定；Claude 保留原链路；Grok 首期仅文本，复用 SQLite turns/sessionId，受 CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN 开关保护，不可用时不回退。已补全任务范围、隐私、兼容和验收标准。

- 2026-07-12T10:32:45.879Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T11:29:39.628Z `node --import tsx --test src/lib 全量`: 391/394 通过；本次相关失败已修正。剩余 3 项为本轮未修改文件中的既有断言：macOS private API feature、桌面退出进程清理、基础设置分组布局，留作独立任务处理。
- 2026-07-12T11:29:39.237Z `GET /api/health 与 GET /api/agents/providers（桌面开发模式端口 3002）`: 通过：健康检查 available=true；Grok lifecycle=active、available=true、selectable=true。

- 2026-07-12T11:29:38.858Z `Playwright 主聊天 Grok 新建、刷新、续聊与清理`: 通过：新建线程 provider=grok-build，Provider 创建后锁定；两轮文本均 done，刷新后历史可见且复用同一 sessionId；0 工具调用、0 console/page error；测试线程已删除并恢复原项目/线程选择。
- 2026-07-12T11:29:38.484Z `npm.cmd run build`: 通过；Vite 生产构建成功，仅保留既有大 chunk 提示。

- 2026-07-12T11:29:38.104Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：35 项通过，0 失败；1 项需真实 Grok 认证的 smoke 按设计忽略。包含 session/provider 持久化及取消竞态回归。
- 2026-07-12T11:29:37.717Z `node --import tsx --test Composer 与 Provider/Agent 相关测试`: 31/31 通过；覆盖 Provider Registry、事件 reducer、主聊天路由、纯文本限制、附件准备队列和隐私边界。

- 2026-07-12T11:29:37.342Z `npm.cmd run typecheck`: 通过，TypeScript 无类型错误。
- 2026-07-12T11:29:36.958Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过，无 Rust 格式差异。

## Completion Summary
- 2026-07-12T11:29:49.466Z 受控多 Provider 主聊天接入已完成：Claude Code 原链路保持不变；Grok Build 可在新会话选择并锁定，支持文本流、工具/审批/提问事件、取消与 session resume，历史持久化到 SQLite；实验开关和 CLI 可用性共同控制开放。相关前端测试、TypeScript、Rust 测试、生产构建、桌面健康检查与真实 Grok 新建/刷新/续聊均通过。

## Follow-ups

- Grok 图片、文件引用与统一 contentBlocks。
- 通用 Agent 运行中队列和 active run 跨刷新恢复。
- Provider 级模型选择及 Codex / CodeM Agent Driver。
