# Task: 接入 Hermes Agent 与基础控制面

## Background

CodeM 已接入 Claude Code、Codex、Grok、OpenCode、Pi 与 Gemini CLI，但尚未接入 Hermes Agent。Hermes 的主要价值不只是代码执行，还包括隔离 Profile、长期记忆、Skills、MCP、通用工具与消息网关。用户确认本次采用原生 `hermes serve` REST + WebSocket JSON-RPC 方案，不使用 ACP，也不复刻完整 Hermes Desktop。

## Objective

将 Hermes 作为可聊天和可由 Agent Mux 调用的 Provider 接入 CodeM，并实现档案、记忆、Skills、MCP、Gateway 与健康信息的首版管理能力

## Scope

In scope:

- 新增稳定 Provider ID `hermes-agent`、图标、注册表、CLI 发现、版本、安装、更新与诊断。
- 新增 Hermes 原生 Driver/Runtime，管理本机 `hermes serve` 后端，支持文本流、新会话、继续会话、取消、唯一终态和 Runtime 清理。
- 接入普通 CodeM 会话、线程 sessionId 持久化、Agent Mux 目录、执行、继续与取消。
- 系统渠道读取 Hermes 当前 Profile 配置；CodeM 自定义渠道继续使用现有渠道和密钥存储，不改写 Hermes 全局登录状态。
- Hermes 专属设置标签：概览、档案、记忆、技能、MCP、网关。
- 档案表示隔离的 Hermes Profile 环境；首版支持列表、选择、基础信息和 SOUL 读写。
- 记忆首版按 Hermes 0.20 原生 API 支持 Provider 状态、学习节点列表、编辑、删除和确认后重置；0.20 未提供额度接口，不新增无效配置项，也不直接拼接写入 `MEMORY.md`。
- Skills 首版支持列表、详情、启停；MCP 首版支持列表、启停、测试、保存和热重载。
- 区分 `hermes serve` Agent 后端与 `hermes gateway` 消息网关；网关首版支持健康、启动、停止、重启和日志。
- 覆盖 Provider 合同、Driver 映射、设置 API、Agent Mux、持久化和安全脱敏测试。

Out of scope:

- ACP 接入、动态 Provider 插件框架和 Hermes Desktop 嵌入。
- 语音、Hermes Cron、完整终端、备份迁移、外观、完整消息平台配置、Cloud/SSH 远程管理。
- Hermes Coding Agents 管理；跨 Agent 协同统一走 CodeM Agent Mux。
- 未经稳定 Hermes API 的手动新增记忆，以及自动同步不同 Agent 的记忆、Skills、MCP 或凭据。
- 将真实 CLI 未验证的能力标记为生产可用。

## Impact

- frontend：Provider 类型/元数据、Agent 设置详情、渠道、Skills/MCP 与 Agent Mux 界面。
- backend：Hermes JSON-RPC Driver、`serve` 进程池、管理 REST 代理、Provider 注册、渠道、运行与 Agent Mux。
- persistence：复用现有 thread Provider/sessionId 与 Agent Mux run/sessionId，不新增凭据持久化。
- security：Hermes token、渠道密钥、MCP/记忆 Provider secret 不进入前端历史、trace 或 SQLite。

## Acceptance Criteria

- [ ] `hermes-agent` Provider 元数据、CLI 诊断、系统/自定义渠道和能力声明完整。
- [ ] Hermes 首轮文本、第二轮同 session 继续、取消和错误均通过统一 `AgentRunEvent`，每轮只有一个终态。
- [ ] 同一 Hermes Profile 复用一个 `serve` 后端，不按 CodeM thread 重复启动；Profile、渠道或工作目录不串会话。
- [ ] Agent Mux 可发现、调用、继续和取消 Hermes，并保存稳定 sessionId。
- [ ] 设置页只在 Hermes Provider 下显示专属标签，窄窗口可用，其他 Provider 行为不变。
- [ ] Profile、记忆、Skills、MCP、Gateway/健康基础读取和已纳入范围的写操作可用。
- [ ] `serve` 后端与消息 Gateway 生命周期和状态明确分离。
- [ ] 历史、日志和错误不包含 token、API Key、base64 或无界 raw event。
- [ ] onboarding gate、TypeScript、Rust 格式/测试和生产构建通过；真实 Hermes CLI 验收结果单独记录。

## Verification Commands

- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `npm run typecheck`
- `node --import tsx --test <Hermes focused tests>`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml <Hermes focused tests>`
- `npm run build`
- 本机 Hermes CLI：探测、首轮、续聊、取消、Profile/记忆/Skills/MCP/Gateway 健康验证。

## Implementation Record
- 2026-08-10T02:28:40.830Z 收尾审计通过：onboarding 72/72、TypeScript 类型检查、cargo fmt、Hermes 相关 Rust 测试 11/11、git diff --check、凭据扫描和乱码扫描均通过；构建仅保留仓库既有 chunk/unused 警告。

- 2026-08-09T19:44:12.230Z 完成 Hermes 原生 serve REST + WebSocket JSON-RPC Provider、CodeM 渠道环境映射、会话与 AgentRunEvent、Agent Mux，以及概览/档案/记忆/Skills/MCP/Gateway 专属设置。补齐学习节点读取编辑删除、Skill 内容查看与启停、MCP 新增启停测试删除、网关状态日志、健康诊断和运行时管理；未修改聊天输入框自适应逻辑。
- 2026-08-10T10:09:20+08:00 真实 Hermes 0.20 验收确认 `serve` 默认使用机器级统一服务；CodeM 改为官方 `--isolated` Profile 模式，并按 `profile + channel fingerprint` 管理后端实例。不同 Profile 与自定义渠道不再复用或终止彼此的热 Runtime；消息网关日志改为读取 Hermes `file=gateway` 数据源。
- 2026-08-09T18:08:00.935Z 已确认范围：Provider ID 使用 hermes-agent；原生协议使用 hermes serve 的 REST + WebSocket JSON-RPC，不使用 ACP；档案表示隔离的 Hermes Profile 环境；模型与认证复用 CodeM 渠道管理；首版不复刻语音、Cron、备份迁移、完整消息平台配置、Cloud/SSH 与 Hermes Desktop。

- 2026-08-09T18:08:00.293Z Task created by Trellis automation.

## Verification Results
- 2026-08-10T02:28:42.789Z `git diff --check + credential/replacement scan`: 通过；无实际凭据或乱码

- 2026-08-10T02:28:42.465Z `npm run build`: 通过，只有既有 chunk/unused 警告
- 2026-08-10T02:28:42.108Z `cargo test --manifest-path src-tauri/Cargo.toml hermes --lib`: Hermes 相关测试 11/11 通过

- 2026-08-10T02:28:41.756Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过
- 2026-08-10T02:28:41.435Z `npm run typecheck`: 通过

- 2026-08-10T02:28:41.134Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: 通过，72/72
- 2026-08-09T19:44:38.213Z `Hermes 0.20.0 真实 CLI 与桌面启动`: 官方源码隔离环境 hermes --version 通过；此前 ready-file、status/profiles/memory/skills/MCP/logs 与 WebSocket session.create 实测通过。桌面 dev 已重启，Vite 5173 与 Agent Mux Runtime identity protocolVersion=2 正常。未使用或落盘用户密钥，真实模型调用仍标记未验证。

- 2026-08-09T19:44:29.960Z `TypeScript、前端回归、生产构建与 onboarding gate`: npm run typecheck 通过；Provider/Agent Mux 38/38；onboarding 72/72；npm run build 通过；git diff --check 通过。
- 2026-08-09T19:44:22.556Z `cargo check + Hermes/Agent Runtime/Agent Mux focused tests`: cargo check 0 errors；Hermes 7/7、Agent Runtime 17/17、Agent Mux 20/20 通过。

## Completion Summary
- 2026-08-10T02:28:56.297Z Hermes Agent 首版集成及真实验收收尾完成：原生 hermes serve REST/WebSocket、CodeM 渠道认证复用、Profile 隔离、普通会话与 Agent Mux、档案/记忆/Skills/MCP/Gateway/健康设置均已接入；自动门禁、类型检查、Rust 格式与 Hermes 测试、生产构建、敏感信息和乱码审计通过。聊天输入框自适应逻辑未修改。

- 2026-08-10T02:05:43.666Z Hermes Agent 首版集成完成
- 2026-08-09T19:44:48.913Z Hermes Agent 首版开发完成：原生 JSON-RPC 会话、渠道认证复用、Agent Mux 与档案/记忆/Skills/MCP/Gateway/健康设置均已接入并通过自动门禁；真实 Hermes 服务接口与 session.create 已验证。由于未把用户密钥注入进程，真实模型首轮/续聊/取消仍作为发布前验收项，不宣称完整生产可用。

## Follow-ups

- Hermes Skills Hub 安装/更新/安全扫描、MCP Catalog/OAuth、外部记忆 Provider OAuth 和手动新增记忆接口。
- Hermes Cloud、SSH 与远程 `serve` 连接。
