# Session Record: 修复 DSH alpha.3 Agent 兼容与浏览器弹窗

- Session: session-20260901-092805-y8lk
- Started: 2026-09-01T09:28:05.966Z
- Task: .trellis/tasks/dsh-acp-alpha3-compatibility.md

## Notes

- 2026-09-01T12:25:40.869Z 根因修复：Windows npm 同时提供 dsh.ps1、dsh.cmd 和无扩展名 dsh；PATH 探测原先优先选择 dsh.ps1，PowerShell -File 未可靠转发 ACP stdin，导致模型目录请求超时。DSH PATH 探测现复用 Windows 可启动命令筛选，优先 dsh.cmd；显式 DSH_CLI_PATH 仍保持原值。dsh.cmd 已实测可完成 ACP initialize/session/new。
- 2026-09-01T11:32:19.385Z 架构修正：废弃"切换意图延迟生效"模型（窗口期内 thread 元数据仍属旧 Agent，渠道/模型/权限持久化被后端校验拒绝，连环出现权限回落/渠道误报/渠道与 Agent 不匹配），改为"选择即切换、发送时注入上下文"：handleSelectAgentProvider→switchThreadProvider 立即 selectDraftProvider+权限继承+persistThreadMetadata({providerId})（后端切换并关旧 runtime，bootstrap 刷新使菜单全部随新 Agent 一致）；pendingContinuationByThreadRef 记录来源 provider，发送时 buildPendingContinuationSubmission 一次性注入转录前缀（新 Agent 仍只在用户发消息时开始运行）。删除 threadProviderOverride。修复 selectDraftProvider 渠道残留：draftProviderId 未变时也重置渠道（全局单值渠道 state 残留旧 provider 渠道 id）。

- 2026-09-01T11:23:48.930Z 渠道误报修复：切换 Provider 意图就绪但未随发送生效时（override 存在），渠道菜单已展示目标 Provider 的渠道，而 handleChannelSelect 仍用当前 thread 的 provider 反查渠道导致"所选 Agent 渠道不可用"误报。改为按渠道 id 在渠道表中直接查找并以其 providerId 决定元数据补丁（Codex 渠道绑定判断）。
- 2026-09-01T11:14:02.251Z 权限继承修复：consumePendingProviderSwitch 在 selectDraftProvider 重置权限为默认后，恢复源会话的 thread.permissionMode（isVisiblePermissionMode 校验后分别走 Claude/generic 的 handlePermissionModeSelect），切换 Agent 后权限模式不再回落到"默认"。

- 2026-09-01T10:49:33.428Z 需求变更重做完成：按用户要求改为当前会话内切换——threadProviderOverride 静默记录目标（无弹窗/toast），发送时 consumePendingProviderSwitch 消费（转录前缀+persistThreadMetadata({providerId})+构造切换后 thread 提交）；后端 update_thread 支持 providerId（清 session/transcript/渠道指纹+关旧 runtime+返回 workspace bootstrap），新增后端测试。撤销弹窗与新建聊天路径。
- 2026-09-01T09:29:03.434Z 已确认并记录实现边界：deepseek-dsh 保持 active，Agent Driver 迁移到官方 dsh --profile acp；设置页禁止自动启动 Web Host；旧 Web API 能力降为不支持；不修改用户 DSH 凭据；Windows alpha.3 做真实 CLI 验收。

- 2026-09-01T09:28:05.971Z Session started.

## Verification

- 2026-09-01T12:28:58.721Z `npm run typecheck; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; check_onboarding.py`: 全部通过：TypeScript 类型检查、Vite 生产构建、Rust 格式检查、CodeM Agent onboarding gate；构建仅有既有大 chunk 提示，Rust 仅有旧 DSH Web 死代码 dead-code 警告。
- 2026-09-01T12:25:41.797Z `DSH alpha.3 Windows ACP 真实验收：dsh --version；dsh --profile acp --help；/api/agents/deepseek-dsh/models?refresh=true；/api/agents/run 首轮与 sessionId 恢复；取消与 runtime DELETE；真实只读工具调用；检查 dsh 子进程`: 通过：模型目录返回 3 个 ACP 模型和 4 档 reasoning effort；首轮 PONG、第二轮 RESUMED 且复用同一 sessionId；工具事件顺序 tool-start/tool-result/tool-stop/done；取消成功并关闭专用 Runtime；清理后 0 个 CodeM dsh.cmd/node ACP 进程；未打开浏览器或 dsh web。

- 2026-09-01T11:32:19.919Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 814 passed；hooks 20 passed。
- 2026-09-01T11:23:49.438Z `npm run typecheck; node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/multi-provider-chat-routing.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；渠道相关测试 33 passed；hooks 测试 20 passed。

- 2026-09-01T11:14:02.790Z `npm run typecheck; node --import tsx --test src/lib/agent-session-preferences.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/grok-permission-modes.test.ts`: typecheck 通过；相关测试 17 passed 0 failed。
- 2026-09-01T10:49:33.946Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts; cargo check; cargo test; rustfmt --edition 2021 --check src-tauri/src/backend.rs`: typecheck 通过；lib 814 passed；hooks 20 passed；cargo check 通过；cargo test 588+16+21 passed（含新增 update_thread_switches_provider_and_clears_session_state）；rustfmt 通过。

## Completed

- 2026-09-01T12:28:59.653Z DSH alpha.3 已迁移至 ACP，修复 Windows dsh.ps1 stdin 超时和 Web Host 弹窗问题，完成模型目录、首轮、续接、工具调用、取消及进程清理验收。
