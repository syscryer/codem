# Task: 移动伴侣完整接入与桌面同源会话

## Background

移动伴侣已经具备独立 HTTPS 网关、一次性配对、设备权限、任务操作、SSE 和 PWA 基础，但真实 `/mobile` 仍使用独立的扁平消息 DTO 与移动聊天渲染器。该实现无法完整继承桌面端的 Conversation timeline、Thinking、工具状态、审批/用户输入卡片、20 轮窗口、贴底滚动和后续机制演进。用户已确认新的正常 iOS 外壳原型，并要求完成全部真实接入，聊天区域与 CodeM 桌面端保持一致。

## Objective

将已确认的 iOS 原型替换到真实 /mobile，复用 CodeM 桌面 ConversationTurnView 和会话机制，补齐真实任务操作、实时恢复、配对设备、PWA、通知、安全与自动化验收。

## Scope

In scope:

- 用已确认的正常 iOS 实色外壳替换真实 `/mobile`，保留独立移动信息架构。
- 移动会话直接复用桌面 `ConversationPane` 和 `ConversationTurnView`，不再维护第二套聊天渲染器。
- 后端返回脱敏但结构兼容的 `ConversationTurn`、ToolStep、审批和用户输入 DTO。
- 移动 SSE 返回可由 `applyAgentRunEventToTurn` 消费的安全事件，支持事件游标和断线续接。
- 历史每次加载 20 轮，向上滚动继续分页且保持视口。
- 真实支持创建、追问、运行中 guide、停止、审批和用户输入回写。
- 新建任务支持项目、Provider、渠道、模型、推理强度和权限模式。
- 首页、项目、通知、连接和设置页面替换为确认后的 iOS 外壳，支持 50 项窗口加载。
- 完善 PWA 离线壳、更新提示、通知点击、主题、安全区、软键盘和 reduced motion。
- 增加仅提供证书下载与 HTTPS 跳转的局域网首次连接入口，修复新设备无法先信任证书的闭环；任务数据、配对和写操作仍只在 HTTPS 开放。
- 补充移动 DTO 脱敏、权限、事件游标、配对和前端会话机制测试。

Out of scope:

- 不实现手机本地 Agent、终端、文件树、代码编辑器、Git 图、Diff 或公网中继。
- 不向移动端暴露 API Key、环境变量、渠道 base URL、完整终端日志、原始 trace 或绝对项目路径。
- 不复制 AGPL 项目代码或视觉资产。
- 不改变桌面端现有页面结构、普通聊天和 Agent Provider 主流程。

## Impact

- frontend：`src/mobile/**`、`src/main.tsx`、`src/components/ConversationPane.tsx`（仅增加可选远程分页能力）。
- backend：`src-tauri/src/mobile_companion.rs` 的移动 DTO、模型目录、安全 SSE 和对应测试。
- PWA：`public/mobile-sw.js`、`public/manifest.webmanifest`、`index.html` 主题色。
- desktop settings：保留现有移动伴侣启停、二维码、设备权限和撤销功能，仅做必要错误处理与状态完善。

## Acceptance Criteria

- [x] 真实 `/mobile` 使用确认后的 iOS 实色外壳，不再显示旧玻璃化页面。
- [x] 会话区域直接复用桌面 `ConversationPane/ConversationTurnView`，桌面新增聊天机制可自然被移动端继承。
- [x] 未配对设备不能读取任务，设备权限分别限制查看、发送、停止和审批。
- [x] 手机可查看任务、项目、通知和超过 20 轮的历史分页。
- [x] 手机可创建任务、追问、guide、停止、审批和回答用户输入。
- [x] 文本、公开 Thinking、工具状态和终态通过 SSE 实时更新，断线恢复不重复 delta。
- [x] 新建任务可选项目、Provider、渠道、模型、推理强度和权限。
- [x] 375px 无横向溢出，Composer 不遮挡内容，主要触控区至少 44px。
- [x] 深浅主题、离线提示、PWA 更新提示、通知和 reduced motion 可用。
- [x] 移动 API 不返回渠道地址、密钥、绝对路径、原始终端日志或 trace。
- [x] 桌面端类型检查、构建、移动专项 Rust 测试和移动端验收通过；全仓 Rust 测试仅有一个依赖外部服务的既有用例因 HTTP 502 失败。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- 375x812 浏览器验证真实 `/mobile`：配对、首页、详情、创建、追问、停止、审批、提问、断线恢复和 20 轮分页。

## Implementation Record

- 2026-07-19T19:45:47.788Z 权限边界实测：view-only 设备创建返回 403，撤销后 bootstrap 返回 401；SSE after cursor 仅回放剩余终态；历史每页 20 轮并钳制越界 cursor。
- 2026-07-19T19:45:47.348Z 移动会话直接复用桌面 ConversationPane/applyAgentRunEventToTurn；修复 SSE done 丢失、旧 run 延迟清理误删新热会话、Claude 流缺真实 runId、停止误标错误等根因。真实 Claude 验证流式、即时追问、guide、停止和 request_user_input 均通过。

- 2026-07-19T19:45:46.915Z 真实验收修复首次设备证书死锁：新增仅暴露 CA 下载与 HTTPS 跳转的 HTTP 引导端口，服务器证书改为本地 CA 签发，二维码改扫引导页；任务、配对和写操作仍只在 HTTPS。
- 2026-07-19T18:31:12.379Z 完成全链路审计：现有 HTTPS 配对、设备权限、任务控制和 PWA 基础保留；核心迁移为移动后端输出脱敏 ConversationTurn 与安全 AgentRunEvent，前端真实 /mobile 直接复用 ConversationPane/ConversationTurnView 和 applyAgentRunEventToTurn。新建任务补 Provider/渠道/模型目录，ConversationPane 增加可选远程历史分页。

- 2026-07-19T18:25:54.851Z Task created by Trellis automation.

## Verification Results

- 2026-07-19T19:52:22.612Z `cargo test --manifest-path src-tauri/Cargo.toml`: 最终复测全通过：library 200 passed、0 failed、1 ignored；桌面壳 13 passed；doc tests 通过。此前 HTTP 502 为瞬时外部波动。
- 2026-07-19T19:49:36.410Z `桌面开发验收环境`: CodeM Dev 已启动；3001 后端、3209 首次引导、3210 HTTPS 移动端均监听，防火墙 configured，375x812 引导页 scrollWidth=375、按钮高度=48px

- 2026-07-19T19:46:10.608Z `真实移动 API 验收`: Claude 流式 done、热追问、guide、停止、request_user_input、权限撤销、SSE cursor 续接均通过；375x812 首次连接页无横向溢出且按钮 48px
- 2026-07-19T19:46:10.191Z `git diff --check`: 通过，仅有仓库行尾转换提示

- 2026-07-19T19:46:09.763Z `cargo test --manifest-path src-tauri/Cargo.toml`: 198 通过、1 忽略；1 个普通 AI 外部流式协议测试因上游 HTTP 502 失败，与移动改动无关
- 2026-07-19T19:46:09.375Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 16 项通过，覆盖配对、权限、脱敏、SSE、CA 引导、热会话清理和 20 轮分页

- 2026-07-19T19:46:08.931Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过
- 2026-07-19T19:46:08.473Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 2 项通过，确认移动详情直接复用桌面会话组件、事件 reducer 与远程分页滚动机制

- 2026-07-19T19:46:08.025Z `npm run build`: 通过，Vite 生产构建完成
- 2026-07-19T19:46:07.584Z `npm run typecheck`: 通过

## Completion Summary

- 2026-07-19T19:52:23.084Z 完成移动伴侣最终复验并更正记录：全仓 Rust 与桌面壳测试全部通过，仅保留需要显式 Grok 凭据的 smoke test 为 ignored。
- 2026-07-19T19:49:36.852Z 完成移动伴侣第一阶段：真实 iOS 实色移动外壳、桌面同源会话渲染与机制、局域网 CA 引导配对、脱敏移动 API、实时 SSE/游标恢复、20 轮分页、创建/追问/guide/停止/用户输入/审批接口、设备权限与撤销、PWA/通知/离线壳。修复真实 runId、热会话竞态、终态丢失与停止语义。专项测试、构建及真实 Claude 链路通过；全仓仅一个外部服务 502 用例未通过。

## Follow-ups

- 第一阶段继续保持局域网 HTTPS PWA；公网 TLS/中继和原生壳后续独立立项。
