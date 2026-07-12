# Task: Grok 权限模式与 YOLO 接入

## Background

CodeM 已将 Grok Build 通过 ACP 接入主聊天，但 Composer 当前只在 Claude Code 会话展示权限菜单，Grok 所有运行都使用 CLI 默认权限。经本机 `grok --help` 确认，Grok 原生支持 `--permission-mode default|auto|bypassPermissions`，可以与 CodeM 现有“默认 / 自动执行 / 完全访问”三档菜单直接对应。

## Objective

复用 CodeM 默认、自动执行、完全访问三档权限菜单，将 Grok 运行映射到原生 permission-mode，持久化到线程并保持 Claude 链路不变。

## Scope

In scope:

- Grok 新会话和已有会话复用现有权限菜单，展示 `default`、`auto`、`bypassPermissions` 三档。
- 新 Grok 会话默认使用安全的 `default`；已有 Grok 线程缺少或保存了不可见值时回落到 `default`。
- 权限模式可在非运行状态切换，运行中禁用并关闭菜单；选择值写入现有 `threads.permission_mode`，刷新后恢复。
- `/api/agents/run` 接收 `permissionMode`，后端使用固定白名单校验后，以参数数组启动 `grok --permission-mode <mode> agent stdio`。
- Grok 每轮运行捕获启动时权限模式；session resume 继续使用线程当前保存的模式。
- 权限菜单保持现有 Lucide 图标、菜单语义、焦点/选中/禁用状态和主题变量，不新增独立 YOLO 开关。
- Claude Code 的权限状态、运行参数、审批卡片和队列链路保持不变。

Out of scope:

- 不开放 Grok 的 `plan`、`acceptEdits`、`dontAsk` 等隐藏模式。
- 不新增 Provider 级默认权限设置，也不把 Claude 的全局默认权限自动套给 Grok。
- 不在 CodeM ACP 层模拟自动批准；`auto` 与 `bypassPermissions` 由 Grok CLI 原生实现。
- 不改变 Grok 首期仅文本、无运行中队列的边界。
- 不扩展 Codex / CodeM Agent 的权限映射。

## Impact

- Frontend：`src/App.tsx`、`src/components/Composer.tsx`、`src/hooks/useAgentRun.ts`、`src/hooks/useWorkspaceState.ts` 及共享权限 helper/tests。
- Backend：`src-tauri/src/agent_run.rs` 的请求校验与 ACP 启动参数；`src-tauri/src/backend.rs` 的 Grok 线程创建/元数据校验。
- Persistence：复用 `threads.permission_mode`，不新增表或迁移；旧 Grok 线程按 `default` 兼容。
- Security：CLI 参数只能来自后端枚举白名单，不拼接命令字符串；完全访问仍受当前 OS 用户权限限制，但会跳过 Grok 工具权限确认，仅适合可信目录。
- UI/UX：复用现有权限触发器与 Popover；通过文字、图标、ARIA 选中态和禁用态表达风险与状态，不依赖颜色。

## Acceptance Criteria

- [x] Grok Composer 显示“默认 / 自动执行 / 完全访问”权限菜单，样式和键盘语义与 Claude 一致。
- [x] Grok 运行中权限触发器禁用且已打开菜单自动关闭；运行结束后可再次切换。
- [x] 新 Grok 线程创建时保存当前权限模式，旧线程或无效可见值安全回落到 `default`。
- [x] 切换 Grok 权限后写入 SQLite，刷新页面仍显示相同模式；续聊使用当前线程模式。
- [x] Agent Run API 对缺省权限使用 `default`，仅接受三项白名单，未知值返回 400。
- [x] ACP 子进程收到 `--permission-mode <mode> agent stdio`，参数未经 shell 拼接。
- [x] `default` 模式仍可产生现有审批卡片；`auto` / `bypassPermissions` 交给 Grok 原生权限机制处理。
- [x] Claude Code 权限菜单、线程持久化和 `/api/claude/run` 参数行为不变。
- [x] TypeScript、相关前端测试、Rust tests、生产构建及桌面开发健康检查通过。

## Verification Commands

- `npm.cmd run typecheck`
- `node --import tsx --test src/lib/composer-input-files.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/grok-permission-modes.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm.cmd run build`
- 启用 `CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN=1` 后重启 `npm.cmd run desktop:dev`，验证 Grok 三档菜单、持久化、运行参数、刷新恢复和健康接口。

## Implementation Record

- 2026-07-12T12:20:27.307Z 桌面完整重启后完成真实验证：修复了 HMR 旧实例导致权限值 undefined 的开发态假象；同时根据截图移除触发器常驻风险 tooltip，避免其遮挡打开的权限菜单，风险说明保留在完全访问菜单项；浅色/暗色及 960/1440 宽度均无溢出。真实 bypassPermissions 请求成功并在运行中锁定控件，测试线程已清理、原选择已恢复。
- 2026-07-12T12:08:29.535Z 已完成 Grok 权限模式跨层实现：复用现有三档权限菜单；useAgentRun 独立管理并持久化 Grok permissionMode；新线程创建、session 保存和每轮 Agent 请求贯穿同一值；Rust 共享白名单仅接受 default/auto/bypassPermissions，并以独立参数数组启动 grok --permission-mode <mode> agent stdio；Grok 运行中权限控件禁用，完全访问提供 YOLO 风险提示；Claude 权限链路保持独立。

- 2026-07-12T11:58:03.517Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T12:20:31.227Z `桌面开发模式 GET /api/health 与 /api/agents/providers`: 通过：3002 health available=true；Grok lifecycle=active、available=true、selectable=true；Web 运行于 5173。
- 2026-07-12T12:20:30.835Z `node --import tsx --test src/lib 全量`: 395/398 通过；本次相关测试全过。剩余 3 项仍为本轮未修改区域的既有 macOS private API、桌面退出清理和基础设置布局断言。

- 2026-07-12T12:20:30.456Z `Playwright 1440x900、960x640 浅色及 1440x900 暗色截图`: 通过：三档菜单、图标、选中态完整；960 宽无横向溢出；YOLO tooltip 不遮挡菜单；明暗主题文字与边框可读。
- 2026-07-12T12:20:30.055Z `Playwright Grok 完全访问真实运行与刷新恢复`: 通过：请求体 permissionMode=bypassPermissions；运行中权限触发器禁用并显示锁定提示；Grok 3 秒内返回 CODEM_GROK_YOLO_OK；线程/回合保存 bypassPermissions 与 sessionId；刷新后仍选中完全访问且历史可见；0 console/page error；测试线程已删除并恢复原选择。

- 2026-07-12T12:20:29.665Z `POST /api/agents/run permissionMode=dontAsk`: 返回 HTTP 400；未知权限模式不会进入 Grok CLI。
- 2026-07-12T12:20:29.277Z `npm.cmd run build`: 通过；Vite 生产构建完成，仅有既有大 chunk 提示。

- 2026-07-12T12:20:28.872Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：37 项通过、0 失败；1 项需显式真实 Grok 配置的 smoke 按设计忽略。新增白名单、固定 ACP 参数、线程权限持久化和非法值回归。
- 2026-07-12T12:20:28.473Z `node --import tsx --test Composer、多 Provider、Grok 权限与 Agent event 聚焦测试`: 23/23 通过；覆盖三档可见模式、状态分流、创建/运行/持久化链路、运行中禁用和隐私边界。

- 2026-07-12T12:20:28.087Z `npm.cmd run typecheck`: 通过，TypeScript 无类型错误。
- 2026-07-12T12:20:27.706Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过，无 Rust 格式差异。

## Completion Summary
- 2026-07-12T12:20:44.567Z Grok 权限模式与 YOLO 已完成：Composer 对 Grok 展示默认、自动执行、完全访问三档；权限按线程持久化并刷新恢复，运行中锁定；Agent API 使用三项白名单并以固定参数数组传给 Grok ACP；真实 bypassPermissions 主聊天运行成功。Claude Code 原权限链路保持独立，桌面开发服务已重启并健康。

## Follow-ups

- Provider 级默认权限设置。
- Codex / CodeM Agent Driver 的权限能力协商与统一映射。
