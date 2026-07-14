# Task: 接入 OpenCode Agent Provider

## Background

CodeM 当前已将 Claude Code、Grok Build 与 OpenAI Codex 接入统一 Provider Registry，但 ACP 运行分支仍写死为 Grok。用户希望把 OpenCode 作为完整 Agent Provider 加入，并使用现有 MiniMax Token Plan 账号做真实联调。

本机已验证 OpenCode `1.17.7`：`opencode acp` 支持 ACP v1、session 新建/恢复/关闭、图片、embedded context、MCP HTTP/SSE、模型 config option、权限与流式事件。真实 `session/set_config_option` 已切换到 `minimax-cn-coding-plan/MiniMax-M2.7` 并返回精确 `PONG`。

## Objective

将 OpenCode 作为完整且独立的 Agent Provider 接入检测、设置、模型目录和主聊天运行链路

## Scope

In scope:

- 新增稳定 Provider id `opencode`、显示名、品牌图标和 `acp` driver 描述。
- 增加 `OPENCODE_CLI_PATH` 与 PATH/常见安装路径解析，Windows 必须返回可直接 spawn 的真实可执行文件。
- 受“实验性 Agent 运行”开关控制 OpenCode 的 active/selectable 状态，并允许设为默认 Agent。
- 将现有 Grok 专用 ACP runtime 泛化为共享 ACP profile，保持 Grok 行为不变。
- OpenCode ACP 支持新建、恢复、热会话复用、流式正文、思考阶段、工具、权限审批、结构化用户输入、取消、usage 与终态。
- 将 CodeM 的 `default / auto / bypassPermissions` 映射为 OpenCode ACP 的交互审批、单次自动允许和优先持久允许策略。
- 模型目录通过 OpenCode CLI 的稳定输出读取；模型切换通过 `session/set_config_option`，不创建模型探测垃圾 session。
- 增加安全的 OpenCode ACP probe 与设置诊断；不读取、不返回、不持久化 API Key。
- 设置页、Composer、工作区状态、使用情况、全局规则、MCP 与 Skills 枚举全部支持 OpenCode。
- OpenCode MCP 配置按 `opencode.json` 的 `mcp` 结构读写，并保留文件中其他配置字段。
- OpenCode Skills 支持全局 `~/.config/opencode/skill(s)` 与项目 `.opencode/skill(s)` 的列出、安装、打开和删除。
- 更新 README 能力描述，补齐 Rust/TypeScript 回归与真实 MiniMax/浏览器验收。

Out of scope:

- CodeM 不接管 OpenCode provider/API Key 登录，不复制或迁移其 `auth.json`。
- 不自动修改用户当前重复的 `oh-my-openagent` 插件配置。
- 不实现 OpenCode 插件市场 CRUD；OpenCode CLI 当前没有与现有面板等价的稳定非交互 list/update/uninstall JSON 契约，运行时仍照常加载用户已有插件。
- 不新增 OpenCode session 导入、fork 或独立会话浏览器；CodeM 仍使用自己的 thread 列表与持久化。
- 不修改普通聊天 Provider、知识库、普通聊天 MCP/Skills 或 API Key vault。

## Impact

- Backend：`src-tauri/src/agent_runtime.rs`、`agent_run.rs`、`acp.rs`、`backend.rs`。
- Shared frontend：`src/constants.ts`、`src/types.ts`、Agent Provider registry/management/settings API helpers。
- UI：Agent Provider 图标与设置、Composer、WorkspaceStatus、GlobalPrompt、MCP、Skills、Usage。
- 文档与测试：README、Trellis、Rust ACP/runtime/backend 测试、前端 Provider/路由/settings/MCP 测试。

## Acceptance Criteria

- [x] 安装 OpenCode 且启用实验运行时，Provider Registry 返回 active、available、selectable 的 `opencode`；关闭实验开关时不可新建。
- [x] 未安装时明确提示 CLI 不可用；支持 `OPENCODE_CLI_PATH`，Windows 不返回不可 spawn 的 `.cmd/.ps1` shim。
- [x] OpenCode 可设为默认 Agent，并能从 Composer 新建任务；已有线程保持原 Provider。
- [x] 模型菜单能读取 OpenCode 模型，选择模型后通过 ACP config option 生效；默认项继续遵循 OpenCode 当前配置。
- [x] MiniMax Token Plan 真实请求能产生正文、思考阶段、usage 与 `done`，且 thread 保存真实 OpenCode session id。
- [x] 同线程后续发送复用热 runtime；关闭或刷新后的 session id 可恢复，不创建无关会话。
- [x] 文本、图片和文件引用均通过 ACP content block 发送。
- [x] 默认权限显示审批卡；auto 与 bypassPermissions 不会永久卡在等待用户输入，且拒绝/取消能正确结束。
- [x] 停止动作发送 ACP cancel，前端运行状态和终态可恢复。
- [x] 设置页显示 OpenCode 版本、命令、配置/Skills 路径、ACP 初始化和模型数量，不展示凭据内容。
- [x] 全局规则定位到 `~/.config/opencode/AGENTS.md`，项目规则继续使用项目 `AGENTS.md`。
- [x] MCP 管理可无损读写 OpenCode 全局/项目配置，保存时不覆盖 model、provider、plugin 等无关字段。
- [x] Skills 能列出和管理 OpenCode 全局/项目目录，同时不把外部只读 Skills 误删。
- [x] Usage Provider 过滤、工作区状态、图标、错误文案和 README 均识别 OpenCode。
- [x] TypeScript、定向前端测试、Rust fmt/check/test、生产构建、Git 差异检查、真实 MiniMax 与浏览器验收全部通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`
- `cargo test --manifest-path src-tauri/Cargo.toml opencode --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_ --lib`
- `npm run typecheck`
- `node --import tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/settings-api.test.ts src/components/WorkspaceStatus.panel.test.ts`
- `npm run build`
- `git diff --check`
- 使用本机 OpenCode + MiniMax Token Plan 真实完成模型切换、两轮 session 复用/恢复、取消和安全输出检查。
- Playwright 验证设置页、默认 Agent、Composer Provider/模型选择、运行状态和最终回复。

## Implementation Record
- 2026-07-14T20:42:12.687Z 修正 OpenCode ACP usage 口径：session usage_update 只作为 context 事件，不再合并进 done 的本轮 result usage；定向测试与 fmt 通过

- 2026-07-14T19:17:42.318Z 完成 OpenCode 后端 Provider Registry、Windows 可执行文件解析、共享 ACP runtime、模型 config option、权限策略、诊断、MCP/Skills 与插件安全边界；普通聊天链路未改动。
- 2026-07-14T18:33:24.674Z 完成 OpenCode 1.17.7 ACP 与 MiniMax Token Plan 真实调研；冻结 opencode Provider、共享 ACP runtime、模型 config option、权限、诊断、MCP/Skills 和前端验收边界。

- 2026-07-14T18:06:59.965Z Task created by Trellis automation.

## Verification Results

- 2026-07-14T21:34:18.853Z `提交前敏感信息扫描`: 通过：扫描 34 个拟提交文件，无真实 API Key/Bearer/私钥/AWS Key/完整 OpenCode session id；仅有脱敏测试哨兵
- 2026-07-14T21:29:51.592Z `Playwright 1280px/760px 浏览器验收`: 通过：设置、默认 Agent、Composer 模型、MCP、Skills、规则、Usage 均正常；console 0 error

- 2026-07-14T21:29:50.768Z `OpenCode + MiniMax Token Plan 真实验收`: 通过：ACP v1/199 模型；恢复、热复用、usage context/result 分离、取消、清理均成功，密钥未进入工作区
- 2026-07-14T21:29:49.931Z `git diff --check`: 通过：无 whitespace error

- 2026-07-14T21:29:49.099Z `npm run build`: 通过：生产构建成功，仅有仓库既有 Tauri import 与 chunk size 提示
- 2026-07-14T21:29:48.283Z `node --import tsx --test src/**/*.test.ts`: 通过：前端全量 458 passed，0 failed

- 2026-07-14T21:29:47.461Z `npm run typecheck`: 通过：TypeScript project references 编译成功
- 2026-07-14T21:29:46.640Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 通过：106 passed，0 failed，1 ignored（需显式认证 Grok 的真实 smoke）

- 2026-07-14T21:29:45.831Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过：codem-backend 编译成功
- 2026-07-14T21:29:44.989Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust 格式无差异

- 2026-07-14T19:46:41.217Z `npm run build`: pass: production build completed; only existing Tauri import and large chunk warnings remain
- 2026-07-14T19:46:23.216Z `node --import tsx --test (all src test files)`: pass: 458 passed, 0 failed

- 2026-07-14T19:46:12.686Z `npm run typecheck`: pass: TypeScript project references compiled successfully
- 2026-07-14T19:46:02.598Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: pass: 105 passed, 0 failed, 1 ignored (real Grok smoke requires explicit authenticated CLI)

- 2026-07-14T19:17:58.082Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: pass: codem-backend dev profile compiled successfully
- 2026-07-14T19:17:50.472Z `cargo test --manifest-path src-tauri/Cargo.toml opencode --lib`: pass: 5 passed, 0 failed; covered registry, model parsing, permission mapping, MCP round-trip and Skills roots

## Completion Summary
- 2026-07-14T21:34:19.710Z 完成 OpenCode 独立 Agent Provider：接入 Registry/诊断/模型目录/ACP 热会话与恢复/流式正文思考工具审批取消/usage 语义、MCP/Skills/规则/Usage 和完整前端入口；真实 MiniMax、浏览器与全量门禁通过，联调数据已清理

## Follow-ups

- OpenCode 若后续提供稳定插件管理 JSON API，再接入 CodeM 插件市场操作；本轮不通过猜测配置语义实现。
