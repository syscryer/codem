# Task: DSH Web API 原生接入

## Background

CodeM 已完成 DeepSeek DSH 的安装、渠道、设置和 Headless 运行接入，但 Headless 只能稳定获得最终结果，无法完整承载 DSH Web 端已经提供的增量输出、工具事件、审批、提问、队列、预设、Skills 和子 Agent 能力。DSH 官方 Web Host 采用 HTTP RPC 上行与 WebSocket 事件下行，适合作为 CodeM 的主接入协议。

## Objective

将 DSH 从 Headless 最终输出驱动升级为由 CodeM 管理的 Web Host API 与 WebSocket 全功能驱动

## Scope

In scope:

- 由 CodeM 启动、复用、停止本地 `dsh web` Host，并按渠道配置隔离运行实例。
- 封装受控的 HTTP RPC、Mux/Host WebSocket 订阅和 `/api/respond` 响应能力。
- DSH 聊天主路径改用持久化 Session，而不是每轮 Headless 独立进程。
- 映射文本增量、思考、工具、计划、完成、错误、取消、审批和用户提问事件。
- 更新 Provider capabilities，使前端按真实协议能力展示流式、审批和用户输入支持。
- 为后续设置页接入模型、预设、Skills、子 Agent 和 DSH 设置提供统一适配层。

Out of scope:

- 不复制 DSH 自身的会话、队列、预设或设置业务逻辑。
- 不开放任意 URL 或任意 DSH RPC 方法代理。
- 本阶段不重做 CodeM 通用聊天 UI；复用现有事件和交互卡片。
- 不删除 Headless 辅助实现，保留为兼容或故障诊断路径。

## Impact

- Backend：新增 DSH Host 生命周期与协议模块，调整 Agent driver、运行状态、取消和交互响应链路。
- Persistence：CodeM thread 的 provider session id 复用 DSH session id，不保存 DSH 凭据或敏感事件正文。
- Frontend：沿用现有流式、工具、计划、审批和提问事件；设置页后续通过受控接口读取 DSH 原生能力。
- Runtime：Rust 改动后必须关闭旧 Agent Mux Runtime 并完整重启桌面开发模式。

## Acceptance Criteria

- [ ] CodeM 能在私有回环端口启动并健康检查 `dsh web`，退出时停止托管子进程。
- [ ] 自定义渠道的 API Key、Base URL 和模型配置只注入对应 DSH Host，互不串用。
- [ ] 新建 DSH 聊天创建原生 session，续聊复用同一 session id。
- [ ] 回答通过 WebSocket 按 chunk 实时显示，不等待整轮完成。
- [ ] 工具调用、工具结果、计划、完成和错误能映射到现有 CodeM 事件。
- [ ] 停止运行会调用 DSH session cancel，并终止 CodeM 当前流。
- [ ] DSH 审批和用户提问能显示现有交互卡片，用户响应通过 `/api/respond` 返回 DSH。
- [ ] Provider Registry 正确声明 streaming、approval、userInput 等能力。
- [ ] 协议解析和关键事件映射有自动化测试，前后端构建通过。
- [ ] 完整重启桌面与 Agent Mux 后，用真实 DSH 会话验证逐块输出和续聊。

## Verification Commands

- `node --import tsx --test <相关 src 测试文件>`
- `npm.cmd run build`
- `cargo test --manifest-path src-tauri/Cargo.toml <DSH 相关测试> -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
- `git diff --check`
- 桌面开发模式真实创建 DSH 会话，验证流式、续聊、停止和交互事件。

## Implementation Record

- 2026-08-13T15:25:38.748Z 真实 Runtime 验收通过：driverId=dsh-web-api，首轮 delta 早于 done；同一 sessionId 续聊两轮均流式完成；桌面与 Agent Mux 已重启到 0.1.24，保留用户手动 DSH Host 127.0.0.1:3080。
- 2026-08-13T15:25:38.467Z 完成 DSH 原生设置只读聚合：新增 /api/agents/dsh/bootstrap，按 allowlist 聚合 agentPreset.list、llm.providers、llm.models、settings.describe，不返回密钥；Agent 设置页展示工具模式、预设、供应商、模型和设置命名空间。

- 2026-08-13T15:25:38.183Z 完成 DSH Web Host API 主驱动：CodeM 托管隔离 Host，HTTP RPC 上行与 WebSocket 事件下行，支持原生 session 新建/续聊、流式文本与思考、工具/计划、取消、审批和用户提问；Headless 仅保留无 thread 兼容路径。
- 2026-08-13T14:18:03.743Z 确认采用 DSH Web Host API 作为主驱动：HTTP RPC 上行、WebSocket 事件下行；Headless 仅保留兼容辅助路径。已补齐任务范围、验收标准和验证计划。

- 2026-08-13T14:14:04.280Z Task created by Trellis automation.

## Verification Results

- 2026-08-13T15:25:40.451Z `GET /api/agents/dsh/bootstrap`: 真实 0.1.24 Runtime 返回 4 presets、37 providers、2 models、11 settings namespaces，未输出密钥
- 2026-08-13T15:25:40.172Z `git diff --check`: 通过，仅有 Windows 换行提示

- 2026-08-13T15:25:39.894Z `npm.cmd run build`: 通过，仅有既有 Vite chunk/dynamic import 警告
- 2026-08-13T15:25:39.597Z `cargo test --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 5/5 通过

- 2026-08-13T15:25:39.309Z `cargo test --manifest-path src-tauri/Cargo.toml --no-run`: 通过，仅有既有 dead_code 警告
- 2026-08-13T15:25:39.028Z `cargo fmt --manifest-path src-tauri/Cargo.toml`: 通过

## Completion Summary
- 2026-08-13T15:25:54.481Z 完成 DeepSeek DSH Web API 原生接入：主聊天链路使用托管 Web Host 与 WebSocket 实时事件，支持热会话续聊、流式、工具、计划、取消、审批和用户提问；设置页新增受控脱敏的原生预设、供应商、模型和设置概览。Rust/前端构建、5 项 DSH 测试、真实 Runtime 流式续聊与 bootstrap 接口均通过，桌面开发模式已重启。

## Follow-ups

- 设置页逐步开放 DSH 原生预设、Settings、Skills、模型发现和子 Agent 管理。
- 评估 Host 进程空闲回收、崩溃恢复和版本协议兼容策略。
