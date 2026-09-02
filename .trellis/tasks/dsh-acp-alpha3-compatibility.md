# Task: 修复 DSH alpha.3 Agent 兼容与浏览器弹窗

## Background

本机 DSH 已由 `0.1.1-rc.2` 更新到 `0.1.2-alpha.3`。新版 `web` profile 默认打开浏览器，并要求启动 URL 中的进程 token 先换取签名 Cookie；HTTP RPC 与 WebSocket 已迁到新的 Remote carrier。CodeM 仍以 `dsh-web-api` 启动 `--profile web`，调用旧的 `/api/{method}`、`/api/events.mux` 与 `host.describe`，因此就绪探测收到 401 后等待 45 秒超时。超时只结束外层 npm/PowerShell 启动器，Node Web Host 子进程残留，重复进入设置页或发送消息会不断启动新 Host 并弹出浏览器。

DSH 当前正式提供 `dsh --profile acp` 作为 automation-only ACP v1 stdio 入口。CodeM 已有共享 ACP Driver/Runtime，可复用其 session、stream、tool、approval、cancel、模型与终态映射。

## Objective

将 DeepSeek DSH Agent 运行迁移到官方 ACP stdio，停止页面加载自动启动 Web Host，修复超时残留进程并完成 Windows 真实 CLI 验收

## Scope

In scope:

- `deepseek-dsh` 保持 active/selectable，Driver 从 `dsh-web-api` 迁移到共享 ACP。
- 使用 `dsh --profile acp` 启动，保留 CodeM 渠道环境隔离、工作目录、权限、模型和 session 身份。
- 设置页不再挂载即启动 DSH Web Host；删除或隐藏依赖旧 Web API 的原生 bootstrap、preset、tools、projection/usage 表面，避免展示伪能力。
- Web UI 如保留入口，只能由用户显式触发，并使用新版安全边界；普通 Agent 运行不得启动浏览器。
- 清理升级/旧失败遗留的 CodeM DSH Web Host；后续失败和应用退出不得留下子进程。
- 更新 Provider 元数据、协议标签、能力声明、README 与回归测试。
- Windows 上对本机 `dsh 0.1.2-alpha.3` 做真实 ACP CLI 验收。

Out of scope:

- 不修改或迁移用户全局 DSH 凭据、profile 配置和 `$DSH_HOME`。
- 不实现 DSH 新 Web Remote 协议客户端；Web profile 只作为独立人机 UI，不作为 CodeM Agent Driver。
- 不恢复旧 Web API 专属 preset/settings/projection 能力，除非 ACP 公开协议提供等价结构化能力。
- 不改当前 Provider 切换与续接任务的代码和行为。

## Impact

- Backend：`src-tauri/src/agent_runtime.rs`、`src-tauri/src/agent_run.rs`、`src-tauri/src/acp.rs`（仅在 DSH ACP 兼容确需时）、`src-tauri/src/dsh.rs`（旧 Web Host 收口/移除）。
- Frontend：`src/components/settings/DshSettingsPanel.tsx`、`src/lib/settings-api.ts`、Provider 元数据/契约测试。
- Documentation：README 的 DSH 协议边界与本任务记录。
- Persistence：保持 CodeM thread/provider/session/event 合同，不新增凭据或 token 持久化。

## Acceptance Criteria

- [ ] 打开 Agent/DSH 设置页面不会启动 `dsh --profile web`，也不会打开浏览器。
- [ ] DSH 首轮和第二轮通过 `dsh --profile acp` 运行，sessionId 有效且热 Runtime 可复用。
- [ ] 普通发送、队列、guide、取消、审批/提问、终态唯一性继续走共享 `AgentRunEvent` 合同。
- [ ] DSH 模型目录和模型选择来自 ACP 能力协商；不支持的旧 Web 原生能力不再展示为可用。
- [ ] 运行失败、取消、应用退出和更新准备不会留下 CodeM 启动的 DSH 子进程。
- [ ] 当前 3 个遗留 Web Host 被精确清理，其他非 CodeM DSH 进程不受影响。
- [ ] Provider 元数据、Driver ID、协议标签和 README 与实现一致。
- [ ] focused Rust/TypeScript tests、typecheck、build、rustfmt、onboarding gate 通过。
- [ ] Windows 真实 CLI 验收记录首轮、续轮、模型/工具事件、取消与清理；无法验证的能力明确列出。

## Verification Commands

- `dsh --version`
- `dsh --profile acp --help`
- `node --import tsx --test <focused test files>`
- `cargo test --manifest-path src-tauri/Cargo.toml <focused tests> -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- `npm run build`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- 桌面开发模式真实 DSH ACP 首轮/续轮/取消/进程清理验收。

## Implementation Record

- 2026-09-01T12:25:40.869Z 根因修复：Windows npm 同时提供 dsh.ps1、dsh.cmd 和无扩展名 dsh；PATH 探测原先优先选择 dsh.ps1，PowerShell -File 未可靠转发 ACP stdin，导致模型目录请求超时。DSH PATH 探测现复用 Windows 可启动命令筛选，优先 dsh.cmd；显式 DSH_CLI_PATH 仍保持原值。dsh.cmd 已实测可完成 ACP initialize/session/new。
- 2026-09-01T11:32:19.385Z 架构修正：废弃"切换意图延迟生效"模型（窗口期内 thread 元数据仍属旧 Agent，渠道/模型/权限持久化被后端校验拒绝，连环出现权限回落/渠道误报/渠道与 Agent 不匹配），改为"选择即切换、发送时注入上下文"：handleSelectAgentProvider→switchThreadProvider 立即 selectDraftProvider+权限继承+persistThreadMetadata({providerId})（后端切换并关旧 runtime，bootstrap 刷新使菜单全部随新 Agent 一致）；pendingContinuationByThreadRef 记录来源 provider，发送时 buildPendingContinuationSubmission 一次性注入转录前缀（新 Agent 仍只在用户发消息时开始运行）。删除 threadProviderOverride。修复 selectDraftProvider 渠道残留：draftProviderId 未变时也重置渠道（全局单值渠道 state 残留旧 provider 渠道 id）。

- 2026-09-01T11:23:48.930Z 渠道误报修复：切换 Provider 意图就绪但未随发送生效时（override 存在），渠道菜单已展示目标 Provider 的渠道，而 handleChannelSelect 仍用当前 thread 的 provider 反查渠道导致"所选 Agent 渠道不可用"误报。改为按渠道 id 在渠道表中直接查找并以其 providerId 决定元数据补丁（Codex 渠道绑定判断）。
- 2026-09-01T11:14:02.251Z 权限继承修复：consumePendingProviderSwitch 在 selectDraftProvider 重置权限为默认后，恢复源会话的 thread.permissionMode（isVisiblePermissionMode 校验后分别走 Claude/generic 的 handlePermissionModeSelect），切换 Agent 后权限模式不再回落到"默认"。

- 2026-09-01T10:49:33.428Z 需求变更重做完成：按用户要求改为当前会话内切换——threadProviderOverride 静默记录目标（无弹窗/toast），发送时 consumePendingProviderSwitch 消费（转录前缀+persistThreadMetadata({providerId})+构造切换后 thread 提交）；后端 update_thread 支持 providerId（清 session/transcript/渠道指纹+关旧 runtime+返回 workspace bootstrap），新增后端测试。撤销弹窗与新建聊天路径。
- 2026-09-01T09:29:03.434Z 已确认并记录实现边界：deepseek-dsh 保持 active，Agent Driver 迁移到官方 dsh --profile acp；设置页禁止自动启动 Web Host；旧 Web API 能力降为不支持；不修改用户 DSH 凭据；Windows alpha.3 做真实 CLI 验收。

- 2026-09-01T09:28:05.968Z Task created by Trellis automation.

## Verification Results

- 2026-09-01T12:28:58.721Z `npm run typecheck; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; check_onboarding.py`: 全部通过：TypeScript 类型检查、Vite 生产构建、Rust 格式检查、CodeM Agent onboarding gate；构建仅有既有大 chunk 提示，Rust 仅有旧 DSH Web 死代码 dead-code 警告。
- 2026-09-01T12:25:41.797Z `DSH alpha.3 Windows ACP 真实验收：dsh --version；dsh --profile acp --help；/api/agents/deepseek-dsh/models?refresh=true；/api/agents/run 首轮与 sessionId 恢复；取消与 runtime DELETE；真实只读工具调用；检查 dsh 子进程`: 通过：模型目录返回 3 个 ACP 模型和 4 档 reasoning effort；首轮 PONG、第二轮 RESUMED 且复用同一 sessionId；工具事件顺序 tool-start/tool-result/tool-stop/done；取消成功并关闭专用 Runtime；清理后 0 个 CodeM dsh.cmd/node ACP 进程；未打开浏览器或 dsh web。

- 2026-09-01T11:32:19.919Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 814 passed；hooks 20 passed。
- 2026-09-01T11:23:49.438Z `npm run typecheck; node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/multi-provider-chat-routing.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；渠道相关测试 33 passed；hooks 测试 20 passed。

- 2026-09-01T11:14:02.790Z `npm run typecheck; node --import tsx --test src/lib/agent-session-preferences.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/grok-permission-modes.test.ts`: typecheck 通过；相关测试 17 passed 0 failed。
- 2026-09-01T10:49:33.946Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts; cargo check; cargo test; rustfmt --edition 2021 --check src-tauri/src/backend.rs`: typecheck 通过；lib 814 passed；hooks 20 passed；cargo check 通过；cargo test 588+16+21 passed（含新增 update_thread_switches_provider_and_clears_session_state）；rustfmt 通过。

## Completion Summary
- 2026-09-01T12:28:59.653Z DSH alpha.3 已迁移至 ACP，修复 Windows dsh.ps1 stdin 超时和 Web Host 弹窗问题，完成模型目录、首轮、续接、工具调用、取消及进程清理验收。

## Follow-ups

- **已知限制（2026-09-01 实测确认）：`dsh --profile acp`（deepseek-harness-acp 0.0.1 / dsh 0.1.2-alpha.3）不产出流式增量**——直接以 ACP 协议探测，300 字写作请求的完整回复以单条 `agent_message_chunk`（全文一帧、时间跨度 0s）一次性发出，thinking 同样单帧。CodeM 侧的 ACP TextDelta 转发与前端增量渲染链路正常（收不到增量是因为上游没有增量），表现为"等一会一次性出全文"。需上游把 DeepSeek API 的 SSE 流转换为逐 chunk 的 session/update 后，CodeM 内即自动恢复流式观感；CodeM 侧无需改动。
- 如后续需要在 CodeM 内嵌 DSH Web 管理能力，单独按新版 token/Cookie/Remote carrier 设计，不与 Agent ACP Driver 混用。
