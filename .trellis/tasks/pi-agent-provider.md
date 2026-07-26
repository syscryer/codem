# Task: 接入 Pi Agent Provider

## Background

CodeM 当前已经接入 Claude Code、Grok Build、OpenAI Codex 和 OpenCode，但 Provider Registry
中还没有 Pi。Pi 提供原生 `pi --mode rpc` JSONL 协议，能够暴露模型、思考级别、流式文本与
Thinking、工具生命周期、队列、压缩、重试、会话和 Extension UI 等信息。

最初的占位目标使用 `pi-acp`，但上游 ACP 适配器会弱化或缺失 Pi 原生 Thinking、队列、会话树、
Extension UI 和部分运行状态。经需求讨论，改为由 Rust 后端直接接入 Pi RPC，以获得更完整的
控制粒度，并把热会话作为核心能力。

## Objective

通过 Pi 原生 RPC 接入与现有 Agent 同等产品范围的 Pi Agent Provider，支持安装诊断、系统与
自定义渠道、动态模型和思考级别、流式运行、权限与用户交互、可恢复热会话、规则、Skills、
Pi Packages 和使用统计，同时明确 Pi 原生不支持的能力边界。

## Scope

In scope:

- 在 frontend 和 backend 的 Provider Registry 中增加：
  - Provider ID：`pi-agent`
  - Driver ID：`pi-rpc`
  - 显示名称：`Pi`
- 新增独立 Rust Pi RPC 客户端：
  - 启动 `pi --mode rpc`
  - 使用严格 LF 分隔的 JSONL framing
  - 通过请求 ID 关联 command response
  - 分别处理 response、session event、Extension UI request 和 stderr
  - 对单行、缓冲区、stderr 尾部和事件字段设置大小限制
- 把 Pi 原生事件映射为 CodeM 统一 `AgentRunEvent`：
  - `text_delta` -> `delta`
  - `thinking_delta` -> `thinking-delta`
  - 工具开始、更新、结束 -> 统一工具 timeline
  - session state 和 usage -> session / usage
  - retry、compaction、queue -> status / phase
  - `agent_settled` -> 当前 run 的真正 terminal event
- 支持 Pi 热会话：
  - 每个 CodeM thread 最多保留一个长驻 Pi RPC 进程
  - working directory、channel fingerprint、model、thinking level、permission mode 和运行配置
    一致时复用原进程
  - 运行中后续输入使用 Pi 原生 `steer` / `follow_up`
  - 普通停止发送 `abort`，成功后保留健康进程
  - abort 超时、协议损坏或进程退出时才强制关闭
  - 配置变化在当前 run 结束后重建，不在运行中强制切换
  - 应用重启或进程崩溃后，通过已验证的 session ID / session file 冷恢复
  - 不自动重放可能已经产生副作用的 prompt
- 支持 Pi 系统渠道：
  - 使用 Pi 自身 `~/.pi/agent` 配置、认证和模型目录
  - 不读取、展示或复制用户 API Key
- 支持 CodeM 自定义渠道：
  - 仅开放 CodeM 与 Pi 都支持的 API 协议
  - 为 channel/thread 生成隔离的 `PI_CODING_AGENT_DIR`
  - 生成最小模型与认证配置
  - 密钥不进入 RPC trace、错误详情、SQLite 历史或前端 payload
  - 渠道删除时清理对应隔离运行目录
- 支持动态模型和思考级别：
  - 使用 RPC `get_available_models`
  - 使用 RPC `get_available_thinking_levels`
  - 通过 `set_model` / `set_thinking_level` 应用选择
  - 按现有线程与模型偏好规则恢复
- 支持输入与运行：
  - 文本
  - 图片
  - 项目文件引用
  - 流式文本与 Thinking
  - 工具调用和结果
  - 停止、steer 和 follow-up
  - 自动重试与自动压缩状态
  - session usage 与费用统计
- 随 CodeM 加载一个最小 Pi bridge Extension：
  - 将 `select`、`confirm`、`input`、`editor` 映射到现有用户输入和审批卡片
  - 将回答通过 `extension_ui_response` 写回同一个热 RPC 进程
  - `default` 模式拦截写入、编辑、命令执行等有副作用工具
  - `auto` 模式允许常规工具
  - `bypassPermissions` 模式不增加 CodeM 拦截
- 接入现有 Agent 设置范围：
  - 安装、更新、版本和 Node 版本诊断
  - RPC 初始化、认证、模型与思考级别诊断
  - 系统与自定义渠道
  - 全局规则与项目规则
  - Skills
  - Pi Packages
  - 使用统计
- 安装与更新：
  - 要求 Node.js `>=22.19.0` 和 npm
  - 安装 `@earendil-works/pi-coding-agent`
  - npm 安装复用 CodeM 的 HTTP(S) 代理、失败重试和国内镜像策略
  - 更新优先使用 `pi update --self`
- 在能力表和相关设置页中准确呈现支持与不支持状态。

Out of scope:

- 不使用 `pi-acp`。
- 不新增独立 Pi 会话树、fork、clone、export 或 compaction UI；本次只接入 CodeM 已有线程和运行界面。
- 不映射 Pi TUI 专属主题、footer、header、自定义编辑器组件和终端布局。
- 不在首版内实现 Pi MCP。Pi 核心没有原生 MCP，设置页必须明确显示不支持，不能隐式安装或依赖第三方 adapter。
- 不实现 Pi 本身不存在的 sub-agent、内置 Plan Mode 或后台 bash。
- 不重新引入 Node backend 或常驻 Node sidecar。

## Impact

- frontend：
  - `src/types.ts`
  - `src/constants.ts`
  - `src/lib/agent-provider-registry.ts`
  - `src/lib/agent-provider-management.ts`
  - `src/lib/agent-model-selection.ts`
  - `src/lib/agent-channel-*`
  - `src/hooks/useAgentRun.ts`
  - `src/hooks/useAgentChannels.ts`
  - `src/components/AgentProviderIcon.tsx`
  - `src/components/settings/**`
- backend：
  - 新增 `src-tauri/src/pi_rpc.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/agent_runtime.rs`
  - `src-tauri/src/agent_run.rs`
  - `src-tauri/src/agent_channels.rs`
  - `src-tauri/src/backend.rs`
- packaging：
  - CodeM Pi bridge Extension 资源及桌面打包配置
- persistence：
  - 复用现有 thread provider/session/model/reasoning preference 字段
  - 不新增明文 secret 持久化

## Design

详细实施步骤见 [Pi Agent RPC Provider Implementation Plan](./pi-agent-provider-implementation-plan.md)。

### RPC Client Boundary

`pi_rpc.rs` 只负责 Pi 协议和进程通信，不负责 HTTP route、SQLite 或 frontend 语义。它提供：

- 可启动、可关闭的 `PiStdioClient`
- 带 ID 的 command/response API
- 异步事件订阅
- `prompt`、`steer`、`follow_up`、`abort`
- `get_state`、`get_available_models`、`get_available_thinking_levels`
- `set_model`、`set_thinking_level`
- Extension UI response
- session stats

客户端必须按字节查找 LF，不能使用会把 U+2028/U+2029 当换行的通用 line reader。未知事件允许忽略并
记录有限摘要；非法 JSON、stdout EOF、响应 ID/command 不匹配和超时属于协议错误。

### Runtime And Hot Session

`agent_run.rs` 增加 `PiRpc` driver 和 `LiveAgentRuntime::Pi`。Pi runtime 继续使用现有 thread scoped
runtime registry，但配置指纹必须包含：

- Provider ID
- working directory
- channel ID 与 channel fingerprint
- model
- thinking level
- permission mode
- bridge Extension 版本

相同指纹复用 stdin/stdout 和 Pi session；不同指纹只在空闲时替换。一次 prompt 的 terminal event
以 `agent_settled` 为准，因为 `agent_end` 后仍可能发生 retry、compaction retry 或 queued continuation。

### Channels And Secrets

系统渠道不生成新的凭据文件。自定义渠道在 CodeM app data 下使用 thread/channel scoped Pi 目录，
写入 Pi 需要的最小配置。secret 只在生成配置时从 CodeM secret store 读取，不返回 frontend。
运行目录、错误和 trace 只能记录 provider、protocol、base URL、model 和路径摘要。

### Permission And Extension UI

CodeM bridge Extension 是 Pi RPC 的协议补充，不实现 Agent 业务逻辑。它把需要交互的操作转换成
Pi `extension_ui_request`，Rust 再映射到 CodeM 的 `approval-request` 或 `request-user-input`。
用户决定经现有 control channel 写回原 Pi 进程。runtime 等待期间保持可写，不创建新的 session。

### Error Recovery

- RPC 初始化完成且 `get_state` 返回有效 session 后才能持久化 session。
- 当前 run 失败时发送一个明确 terminal error。
- 进程崩溃后保留已确认的 session 元数据，但不自动重放 prompt。
- 下次用户输入启动新进程并恢复 session。
- `abort` 成功只结束本轮；超时后 hard kill，并把 runtime 标记为不可复用。
- 配置变化不影响已运行中的 turn。
- 未知事件向前兼容；协议 framing 损坏则关闭当前 runtime。

## Acceptance Criteria

- [x] Provider Registry 返回 active、可探测的 `pi-agent`，未安装时不可选择且设置页可安装。
- [x] Node.js 版本不足时安装与诊断给出明确提示，不执行必然失败的安装。
- [x] npm 安装、代理重试和国内镜像重试不泄露代理凭据。
- [x] Pi RPC probe 能验证版本、初始化、认证/模型可用性和思考级别。
- [x] 系统渠道使用现有 Pi 配置，不复制 API Key。
- [x] 自定义渠道使用隔离配置，切换渠道不会污染系统 Pi 配置或其他线程。
- [x] frontend 可动态选择 Pi 模型和当前模型实际支持的思考级别。
- [x] 文本、图片、文件引用、Thinking、工具、用量、错误都进入正确 timeline 语义。
- [x] 同一 thread 和相同配置的连续 turn 复用同一 Pi RPC 进程。
- [x] 运行中发送的新需求按现有 CodeM 队列语义映射为 Pi steer/follow-up。
- [x] 普通停止通过 `abort` 结束当前 run，下一次发送仍复用健康进程。
- [x] 进程崩溃或配置变化后能够用已验证 session 冷恢复。
- [x] 失败后不会自动重放可能已经执行过工具的 prompt。
- [x] `agent_settled` 之前不会提前发出 CodeM `done`。
- [x] Extension UI 的确认、选择、输入、编辑和取消能写回原热会话。
- [x] 三种权限模式按设计工作，设置页不宣称 Pi 原生具备不存在的权限系统。
- [x] 全局/项目规则、Skills、Pi Packages 和使用统计接入现有设置入口。
- [x] MCP 页面对 Pi 明确显示不支持，且不会写入无效配置。
- [x] trace、历史、debug event 和错误信息不包含 secret、图片 base64 或大文件全文。
- [x] 现有 Claude、Grok、Codex 和 OpenCode 行为与测试不回归。
- [ ] 修改后的桌面开发模式能够启动并完成一次 Pi 真实 smoke run。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-registry.test.ts`
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`
- `node --import tsx --test src/lib/agent-model-selection.test.ts`
- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml pi_rpc`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run desktop:dev`
- 真实 smoke test 仅在显式提供已认证 Pi 环境时运行，默认标记 ignored。

## Implementation Record

- 2026-07-26T07:47:32.728Z 真实 Pi smoke 发现系统配置无可用模型时 unknown/unknown 被误判为已认证；已改为仅接受 Pi get_available_models 返回的当前模型，并在设置页显示待处理
- 2026-07-26T07:26:38.513Z 完成 Pi Agent 设置、MCP 边界、Rules、Skills、Packages、Usage 与图标界面，并补充 Pi Packages 专属空态及窄屏布局验证

- 2026-07-26T07:00:51.045Z 完成 Pi Extension UI 权限桥接：confirm/input 映射、热进程控制回写、default/auto/bypassPermissions 工具策略、隔离 bridge 资源与脱敏限长摘要
- 2026-07-26T06:08:57.449Z 完成 Pi Agent 生命周期、Node 版本门槛、原生 RPC probe、动态模型目录、Rules/Skills/Packages 路径、MCP 400 边界、可执行命令检测与前端 probe 脱敏归一化；新机器已安装 Pi 0.82.1 并按真实 pi list 输出实现 Packages 解析。

- 2026-07-26T05:32:07.121Z 完成 Pi 系统与自定义渠道：支持 OpenAI Chat、Responses、Anthropic Messages；自定义配置写入 thread 级 PI_CODING_AGENT_DIR，models.json 仅引用生成的环境变量名，密钥不落盘；加入系统渠道、指纹和精确删除边界。
- 2026-07-26T05:26:47.074Z 完成 Pi RPC 热运行时接入：统一 driver/input/runtime，配置指纹包含渠道、模型、思考级别、权限和 bridge 版本；agent_end 非终态，agent_settled 才完成；abort 等待 settled 后保留健康进程；fatal 传输错误标记 runtime failed。

- 2026-07-26T04:56:23.967Z Task 3 完成：实现 PiStdioClient 进程客户端、状态/模型/思考命令、prompt/steer/follow-up、Extension UI 回写、session stats 与类型化流事件；5/5 测试通过
- 2026-07-26T04:47:47.070Z Task 2 完成：实现 Pi RPC 严格 LF JSONL framing、4 MiB 大小限制、非法 JSON 诊断和请求 ID 响应关联；3/3 测试通过

- 2026-07-26T04:44:24.079Z Task 1 完成：注册 pi-agent/pi-rpc Provider，补齐能力描述、通用运行路由和前端穷举映射；Rust 9/9、前端 16/16、typecheck 通过

- 2026-07-26T04:35:05.222Z 完成 Pi Agent RPC 实施计划：九个测试驱动任务覆盖 Provider、RPC、热会话、渠道、生命周期、权限桥接、设置与验收
- 2026-07-26T04:24:24.639Z 完成 Pi 原生 RPC 接入设计：确认同等 Provider 范围、热会话复用、权限桥接、自定义渠道隔离、错误恢复和首版 MCP 边界

- 2026-07-26 用户确认改用 Pi 原生 RPC，并要求与其他 Agent 保持同等产品范围、支持热会话。
- 2026-07-26 已确认架构、产品边界、错误恢复和测试验收设计；首版明确不实现 Pi MCP 和 TUI 专属界面。
- 2026-07-24T02:15:51.423Z 当前 session 仅创建了 Pi Agent 占位任务，尚未开始实现；因用户转向自动化原生调度隔离问题，暂停本 session，任务文件保留供后续继续。

- 2026-07-23T18:56:09.957Z Task created by Trellis automation.

## Verification Results

- 2026-07-26T07:48:14.228Z `npm run desktop:dev；Invoke-RestMethod http://127.0.0.1:3002/api/health；POST /api/agents/pi/probe；POST /api/agents/run；Playwright http://127.0.0.1:5174/ Pi 检测`: 桌面 Vite 5174、后端 3002 已启动且健康；Pi 0.82.1 RPC 初始化成功；真实 run 创建会话并通过 SSE 返回缺少 API key 错误；修复后 probe 返回 authenticated=false/currentModel=null，UI 显示待处理且无控制台错误；认证生成与热复用 smoke 待配置 API key 后补测
- 2026-07-26T07:47:58.034Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；cargo test --manifest-path src-tauri/Cargo.toml pi_rpc；cargo test --manifest-path src-tauri/Cargo.toml agent_run；cargo test --manifest-path src-tauri/Cargo.toml agent_channels；cargo test --manifest-path src-tauri/Cargo.toml backend；cargo test --manifest-path src-tauri/Cargo.toml`: 格式通过；定向测试 pi_rpc 8、agent_run 50、agent_channels 11、backend 74 全通过；全量库测试 221 通过、1 个需认证 Grok 用例忽略，桌面壳 13 通过

- 2026-07-26T07:47:43.623Z `node --import tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts；npm run typecheck`: 50 个前端测试通过；TypeScript 无错误
- 2026-07-26T07:26:38.515Z `npm run typecheck；node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-channel-selection.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-provider-registry.test.ts；Playwright 1440x900/520x900 Pi 设置检查；git diff --check`: TypeScript 通过；49 个前端测试通过；桌面与窄屏页面无控制台错误、无横向溢出；空白检查通过

- 2026-07-26T07:01:06.043Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: PASS
- 2026-07-26T07:01:05.774Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: PASS: 40 passed, 0 failed

- 2026-07-26T07:01:05.458Z `cargo test --manifest-path src-tauri/Cargo.toml pi_rpc`: PASS: 8 passed, 0 failed
- 2026-07-26T06:09:16.167Z `node --import tsx --test src/lib/agent-provider-registry.test.ts && npm run typecheck`: PASS：18 项 registry/probe 测试通过，TypeScript 无错误

- 2026-07-26T06:09:05.786Z `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::pi_`: PASS：8 项 Pi 生命周期、probe、Rules/Skills/Packages/MCP 测试通过
- 2026-07-26T05:32:09.103Z `node --import tsx --test src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts`: 12 passed, 0 failed

- 2026-07-26T05:32:08.107Z `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`: 11 passed, 0 failed
- 2026-07-26T05:27:00.346Z `npm run typecheck`: 通过

- 2026-07-26T05:26:59.339Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过
- 2026-07-26T05:26:58.287Z `cargo test --manifest-path src-tauri/Cargo.toml pi_rpc`: 6 passed, 0 failed

- 2026-07-26T05:26:57.287Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: 36 passed, 0 failed

## Completion Summary

- 2026-07-26T07:48:25.819Z 完成 Pi Agent 原生 RPC、热会话、渠道、权限桥接与设置接入；自动化回归和桌面启动通过，真实 Pi 初始化与错误链路通过，认证生成 smoke 因本机未配置 API key 待补

## Follow-ups

- 后续可独立设计 Pi 会话树、fork、clone、export 和手动 compaction UI。
- 后续如需 MCP，应单独评估受信任的 Pi Extension 或 adapter，不与本任务捆绑。
