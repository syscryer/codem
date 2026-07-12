# Task: Agent 提供商只读管理页

## Background

CodeM 已完成协议中立的 Provider Registry 和 Grok ACP Driver POC，但设置页仍以“模型设置”为唯一入口，用户无法查看不同 CLI 的安装、认证、协议和能力状态。后续计划接入 Grok Build、OpenAI Codex 和自研 Agent，需要先建立不参与运行路由的只读管理界面，并继续把 Claude Code 作为唯一生产 Provider。

## Objective

在不改变现有 Claude Code 会话和发送流程的前提下，为设置页增加多 CLI Provider 的只读发现、状态与诊断界面

## Scope

In scope:

- 将设置侧栏的“模型设置”调整为“Agent 与模型”。
- 在同一设置页面增加“提供商”和“模型与默认值”两个页签，现有 Claude 模型配置保持原行为。
- 提供商页使用紧凑列表 + 详情布局，读取 `/api/agents/providers` 展示生命周期、可用性、Driver 和 capability。
- 复用 `/api/claude/version-info` 展示 Claude CLI 版本状态。
- 仅在用户明确点击时调用 `/api/agents/grok/probe`，展示 Grok 安装、初始化、认证、协议能力和模型摘要。
- 为 Registry 与 Grok probe 增加严格的前端响应归一化和测试。
- 为加载、失败、重试、禁用和键盘焦点提供明确状态，兼容现有明暗主题与窄窗口。

Out of scope:

- 不增加聊天 Provider 选择器，不让 planned Provider 进入发送路径。
- 不修改 `/api/claude/*` 运行接口、`useClaudeRun`、Claude CLI 参数或线程 Provider。
- 不修改 SQLite schema、历史记录、队列、审批、恢复和附件逻辑。
- 不保存或编辑 token、API key、登录缓存、代理地址和外部 Provider 配置。
- 不自动运行 `grok login`，不自动安装或更新任何 CLI。
- 不实现 Grok 工具调用、权限、用户输入或正式聊天运行链路。

## Impact

- frontend：设置页导航和内容编排、新增 Provider 管理组件、Provider probe 客户端类型与测试、主题响应式样式。
- backend：复用现有 Registry、Grok probe 和 Claude version-info，无新增后端行为。
- persistence：无配置或数据库变更；页签、选择和检测结果仅保存在组件内存中。
- compatibility：Claude Code 仍是唯一 active/selectable Provider，现有 Composer 和会话 UI 不出现新控件。
- performance：Registry/Claude 信息仅在页面挂载或手动刷新时读取；Grok probe 仅显式触发且运行中禁止重复点击。

## Acceptance Criteria

- [x] 设置入口显示“Agent 与模型”，可在“提供商”和“模型与默认值”间切换。
- [x] 现有模型默认值、自定义模型和模型能力编辑功能保持可用。
- [x] Provider 列表展示 Claude Code、Grok Build、OpenAI Codex 和 CodeM Agent，且 planned Provider 明确不可选择。
- [x] Claude Code 展示实际安装/版本状态；Registry 或版本请求失败时可重试且不影响其他设置页面。
- [x] Grok probe 只由用户显式触发，运行中显示 loading 并禁止重复调用；成功和失败都给出可恢复状态。
- [x] Grok probe 响应不展示或持久化 token、邮箱、team、订阅和 raw event。
- [x] capability 状态同时使用图标和文字，不只依赖颜色；列表和页签支持键盘操作与可见焦点。
- [x] 明暗主题、窄内容容器单列布局和长路径/模型文本不溢出。
- [x] Provider 客户端定向测试、`npm.cmd run typecheck`、`npm.cmd run build` 和 `git diff --check` 通过。

## Verification Commands

- `npx.cmd tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `git diff --check`
- 浏览器/桌面开发模式验证 Provider 列表、Grok 显式检测、两个页签、明暗主题和窄窗口。

## Implementation Record

- 2026-07-12T09:17:40.375Z 已完成前端数据与页面主体：新增 Grok probe 白名单归一化和取消请求；设置入口改为 Agent 与模型，提供商/模型双页签；Provider 主从详情展示 Registry、Claude 版本、capability 与模型，Grok 仅手动检测且禁止重复调用。现有模型设置保存逻辑原样复用。
- 2026-07-12T09:05:09.735Z 已确认第一阶段 UI 边界：设置入口改为 Agent 与模型，采用提供商/模型与默认值双页签和紧凑主从布局；Provider 管理只读，Grok probe 仅显式触发，planned Provider 不进入发送路径，Claude Code 现有会话与 Composer 不变。

- 2026-07-12T09:02:12.361Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T09:30:57.047Z `git diff --check`: 通过：无空白错误；仅提示 Windows 工作区既有 LF/CRLF 转换。

- 2026-07-12T09:30:47.872Z `隔离 Web 5174 + Rust 39212 + Playwright/Edge：桌面、620px、浅色、深色、加载、失败、7890 Grok 成功、键盘焦点、控制台`: 通过：4 个 Provider 正常；无横向溢出或控制台错误；Grok 检测中禁用重复点击，7890 下 installed/initialized/authenticated=true、ACP v1、2 个模型，仍 planned/selectable=false；响应无 token、邮箱、team、订阅或 raw event。
- 2026-07-12T09:30:35.155Z `cargo test --manifest-path src-tauri/Cargo.toml; cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust lib 16/16、桌面 main 9/9、0 失败，真实 Grok smoke 按设计 ignored；Rust 格式检查无差异。

- 2026-07-12T09:30:23.819Z `npm.cmd run build`: 通过：TypeScript project references 与 Vite production build 成功；仅保留仓库既有动态导入和大 chunk 提示。
- 2026-07-12T09:30:14.144Z `npx.cmd tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/conversation.test.ts src/lib/queued-prompts.test.ts src/lib/claude-run-attachments.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: 通过：45/45；覆盖 Provider/Grok 契约、显式检测、CC 发送延迟、停止、队列、附件、恢复与历史安全回归。

## Completion Summary
- 2026-07-12T09:31:46.166Z 完成 Agent 提供商只读管理页：设置入口调整为 Agent 与模型，新增提供商/模型双页签、Provider 主从详情、Claude CLI 版本、capability/模型展示和显式 Grok ACP 检测；加载/失败/重试/禁用/键盘焦点、明暗主题与窄窗口均已验证。Grok 在 7890 下检测成功但仍 planned/selectable=false，现有 CC 会话、Composer、运行 API 和持久化未改动。

## Follow-ups

- 增加 `experimental` 生命周期和显式启用开关后，再开放 Grok Provider 选择。
- 完成通用运行 API 与 ACP tool/permission/user-input 映射后，才允许 Grok 进入聊天发送路径。
- 后续接入 Codex 与自研 Agent 时复用本页，并以第二、第三个 Driver 校验抽象。
