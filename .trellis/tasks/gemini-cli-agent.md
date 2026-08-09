# Task: 接入 Gemini CLI Agent

## Background

CodeM 已有普通聊天的 Gemini GenerateContent Provider，也已有 Grok Build 与 OpenCode 共用的 ACP Driver，但尚未把 Gemini CLI 作为编码 Agent 接入。Gemini CLI 0.54.4 官方提供 `gemini --acp`，可通过 stdio JSON-RPC 完成会话、流式事件、工具、审批、取消、模型和权限模式控制。

本任务使用独立 Provider ID `gemini-cli`，不与普通聊天的 Gemini Provider 混用。用户已确认采用共享 ACP Driver 方案，并要求系统渠道与 CodeM 自定义渠道同时完成；认证复用现有 `AgentChannelService`、SecretStore 和渠道指纹机制，不新增凭据存储，也不改写 Gemini CLI 全局配置。

## Objective

通过共享 ACP Driver 接入 Gemini CLI，并复用 CodeM 现有系统与自定义渠道管理完成认证、模型、会话和产品面闭环

## Scope

In scope:

- 新增 active `gemini-cli` Provider、元数据、图标复用、CLI 探测、版本、安装、更新和公开诊断。
- 通过共享 ACP Driver 使用 `gemini --acp`，支持文本流、新会话、恢复、热 Runtime、取消、工具、审批、公开思考和唯一终态。
- 补齐 ACP 会话响应中的模型与权限模式解析，以及 `session/set_mode` 和 Gemini 会话模型切换。
- 系统渠道沿用 Gemini CLI 本机登录、配置和模型；CodeM 不读取或保存其 OAuth/Vertex 登录缓存。
- 自定义渠道复用 CodeM Agent 渠道管理，仅允许 `gemini_generate_content`，从 SecretStore 注入 API Key 与 Base URL，按渠道 ID/指纹隔离模型目录、会话和热 Runtime。
- 接通新聊天、队列、guide、附件、Timeline、Markdown/链接、文件变化/Diff、WorkspaceStatus、历史持久化、自动化和 Agent Mux 关联等统一产品面。
- 能力按 `supported`、`unsupported`、`runtime-detected` 明确声明，并补协议、前端、渠道、持久化和安全回归测试。
- 更新 README、Agent 接入合同测试和必要的用户说明。

Out of scope:

- Hermes Agent 接入或兼容性实现。
- 动态 Provider 插件系统或新的 ACP 框架层。
- 修改普通聊天 Gemini Provider 的请求协议或持久化模型。
- 把 OpenAI Responses、OpenAI Chat 或 Anthropic Messages 渠道伪装成 Gemini CLI 渠道。
- 由 CodeM 托管 Google OAuth、Vertex ADC、服务账号文件或改写 `%USERPROFILE%/.gemini`。
- 未经结构化协议证据推断 Plan、文件变化、usage 或隐藏思考。

## Impact

- Frontend：`src/types.ts`、`src/constants.ts`、Provider 元数据/Registry、渠道筛选、Agent 设置和对应测试。
- Backend：`agent_runtime.rs`、`agent_run.rs`、`acp.rs`、`agent_channels.rs`、`backend.rs` 及 Agent Mux Provider 描述。
- Persistence：复用现有 thread provider/session/channel/runtime/history 字段，不新增凭据字段和图片/base64 持久化。
- Security：自定义渠道密钥只从 SecretStore 注入子进程环境；日志、诊断、事件、历史不得包含密钥或未限制 raw event。

## Acceptance Criteria

- [ ] `gemini-cli` Provider ID、前后端元数据、Registry、默认 Agent、设置和自动化名单完整且类型检查通过。
- [ ] CLI 不存在、版本不可读、ACP 初始化失败、系统认证缺失和自定义渠道认证失败均有不泄密的可读诊断。
- [ ] 系统渠道可复用 Gemini CLI 自身配置；自定义 Gemini 渠道可保存、测试、发现/维护模型并在运行时注入 Base URL、API Key 和模型。
- [ ] 模型目录缓存键与热 Runtime 复用条件包含渠道身份/指纹，切换渠道不会串凭据、模型或 session。
- [ ] ACP 文本、公开思考、工具、审批、用户输入、文件变化、usage 和终态按实际能力映射；每轮只有一个 done/error。
- [ ] 新会话、第二轮恢复、取消、default/auto/bypassPermissions 权限映射、模型切换和应用重启恢复通过测试。
- [ ] contentBlocks 在普通发送、队列、guide、重试、恢复和自动化中不丢失；不支持的块在发送前明确拒绝。
- [ ] 实时、SQLite 历史和刷新恢复保持 Provider/session/channel/timeline 顺序一致，凭据、base64 和大正文不落库。
- [ ] Onboarding gate、TypeScript、Rust、生产构建和可执行的真实 Gemini CLI ACP 验收通过；缺少真实凭据的项目明确标为未验证而不是通过。

## Verification Commands

- `node --import tsx --test <focused src/**/*.test.ts files>`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml <focused tests>`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `npm run build`
- 真实 Gemini CLI：版本、隔离 Home ACP 握手、系统/自定义渠道首轮与续聊、取消、审批、工具、附件和恢复。

## Implementation Record
- 2026-08-09T16:09:01.839Z 修复 Gemini CLI ACP：系统渠道只读加载 ~/.gemini/.env 白名单变量；ACP 启动使用 --skip-trust --acp；将 Windows \\?\ 扩展工作目录转换为普通盘符/UNC 路径；增加阶段化 ACP 错误诊断。确认旧 MCP 嵌套配置来自 8 月 1 日既有文件，未擅自改写。

- 2026-08-09T10:59:54.718Z 真实 CLI 边界：当前 PATH 与全局 npm 均没有 @google/gemini-cli，未安装 CLI、未修改 ~/.gemini；因此真实登录、ACP 握手、系统/自定义渠道首轮与续聊、取消、审批、工具、附件、模式和模型切换明确标为未验证。
- 2026-08-09T10:59:31.951Z 收尾 UI 验收覆盖 Agent 设置、Gemini 系统/自定义渠道、MCP、Skills 与 Agent Mux；发现 Gemini CLI 未安装时添加 Agent Mux 配置仍请求模型目录并产生 400，现复用 Provider Registry 可用性在请求前拦截，不影响自定义渠道模型数据。

- 2026-08-09T10:41:43.001Z Claude Agent Mux 回归修复：显式映射 Claude doctor 参数；Runtime 协议升级以淘汰旧进程；前端将 success=null 视为旧 Runtime 未返回结果而非明确失败，success=false 仍保持离线。
- 2026-08-09T08:59:34.627Z 方案确认：新增独立 gemini-cli Provider，复用共享 ACP Driver；系统渠道沿用 Gemini CLI 本机配置，自定义渠道必须复用 CodeM AgentChannelService、SecretStore 与渠道指纹，仅支持 Gemini GenerateContent 协议，不改写 Gemini 全局配置。Hermes 不在本任务范围。

- 2026-08-09T08:46:25.133Z Task created by Trellis automation.

## Verification Results
- 2026-08-09T16:14:57.490Z `真实 Gemini CLI 0.54.4 ACP 系统渠道首轮与同 sessionId 续聊`: 通过：gemini-3.5-flash 首轮 CODEM_ACP_FIRST_OK，续聊 CODEM_ACP_SECOND_OK；sessionId 一致；每轮 1 done、0 error；密钥未输出

- 2026-08-09T16:14:42.257Z `npm run typecheck; npm run build; python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: 通过：TypeScript、Vite 生产构建、Agent onboarding gate
- 2026-08-09T16:14:27.215Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test --manifest-path src-tauri/Cargo.toml --lib; cargo test --manifest-path src-tauri/Cargo.toml --bins`: 通过：rustfmt；lib 458 passed、1 ignored；bins 28/28 passed

- 2026-08-09T10:59:43.688Z `node --import tsx --test src/lib/agent-mux-ui.test.ts; npm run typecheck; git diff --check; Playwright Gemini 设置/渠道/MCP/Skills/Agent Mux 验收; 3002 Provider/probe API`: pass: Agent Mux UI 16/16，TypeScript 通过，diff 无空白错误；Gemini Provider active/acp 且未安装时不可选择，探测返回明确错误；添加配置不再请求模型目录 400
- 2026-08-09T10:54:34.937Z `GET /api/agents/settings-diagnostics?providerId=claude-code&run=true`: 真实 Dev Runtime protocolVersion=2：installed=true，Claude 2.1.220，diagnostic.success=true，exitCode=0

- 2026-08-09T10:54:34.255Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: 通过：CodeM Agent onboarding automated gate passed
- 2026-08-09T10:54:33.474Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test --manifest-path src-tauri/Cargo.toml --lib; cargo test --manifest-path src-tauri/Cargo.toml --bins`: 通过：rustfmt；lib 456 passed、1 ignored；bins 28 passed

- 2026-08-09T10:54:32.840Z `npm run typecheck && npm run build`: 通过：TypeScript 类型检查和 Vite 生产构建成功
- 2026-08-09T10:54:32.220Z `node --import tsx --test src/lib/agent-mux-probe.test.ts src/lib/agent-mux-conversations.test.ts`: 通过：6/6

## Completion Summary

- 2026-08-09T16:15:11.073Z Gemini CLI ACP 真实系统渠道已修复并验收：加载 CC Switch ~/.gemini/.env 白名单配置，使用正式 ACP 启动参数，修正 Windows verbatim cwd，增加阶段化错误；首轮与续聊成功，完整门禁通过。
- 2026-08-09T11:00:07.860Z Gemini CLI 已按方案二通过共享 ACP Driver 完成 CodeM 全产品面接入，系统配置与自定义 Gemini Generate Content 渠道均复用现有渠道和凭据体系；自动化门禁、完整 Rust/TypeScript/构建、API 与浏览器 UI 验收通过。当前机器未安装 Gemini CLI，真实 ACP 与登录运行链路保留为明确未验证边界。

## Follow-ups

- Hermes Agent 在 Gemini CLI 完成后单独立项评估，不占用本任务范围。
