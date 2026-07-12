# Session Record: 多 Provider 聊天接入

- Session: session-20260712-103245-2o4t
- Started: 2026-07-12T10:32:45.877Z
- Task: .trellis/tasks/multi-provider-chat-routing.md

## Notes
- 2026-07-12T11:29:36.583Z 完成受控多 Provider 主聊天接入：Thread.provider 统一路由，Claude 保留原 useClaudeRun 链路，Grok 使用独立 useAgentRun 与 /api/agents/run；Provider 创建后锁定，Grok 首期仅文本；SQLite 持久化 turn/sessionId；取消竞态通过响应 runId 与后端发送前取消检查修复；Provider 菜单、Sidebar、WorkspaceStatus 和主题样式已接入。

- 2026-07-12T10:42:12.276Z Rust 侧已完成 Provider 真相源接入：Registry 仅在实验开关开启且 grok CLI 可用时允许选择；线程创建校验并持久化 provider；非 Claude 线程不参与 transcript 可见性、导入去重、删除忽略记录或历史解析。新增 provider/session 边界测试，cargo check --tests 通过。
- 2026-07-12T10:36:56.242Z 已确认受控主聊天方案：Thread.provider 是会话归属唯一来源；新会话可选 Provider 且创建后锁定；Claude 保留原链路；Grok 首期仅文本，复用 SQLite turns/sessionId，受 CODEM_ENABLE_EXPERIMENTAL_AGENT_RUN 开关保护，不可用时不回退。已补全任务范围、隐私、兼容和验收标准。

- 2026-07-12T10:32:45.880Z Session started.

## Verification

- 2026-07-12T11:29:39.628Z `node --import tsx --test src/lib 全量`: 391/394 通过；本次相关失败已修正。剩余 3 项为本轮未修改文件中的既有断言：macOS private API feature、桌面退出进程清理、基础设置分组布局，留作独立任务处理。
- 2026-07-12T11:29:39.237Z `GET /api/health 与 GET /api/agents/providers（桌面开发模式端口 3002）`: 通过：健康检查 available=true；Grok lifecycle=active、available=true、selectable=true。

- 2026-07-12T11:29:38.858Z `Playwright 主聊天 Grok 新建、刷新、续聊与清理`: 通过：新建线程 provider=grok-build，Provider 创建后锁定；两轮文本均 done，刷新后历史可见且复用同一 sessionId；0 工具调用、0 console/page error；测试线程已删除并恢复原项目/线程选择。
- 2026-07-12T11:29:38.484Z `npm.cmd run build`: 通过；Vite 生产构建成功，仅保留既有大 chunk 提示。

- 2026-07-12T11:29:38.104Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：35 项通过，0 失败；1 项需真实 Grok 认证的 smoke 按设计忽略。包含 session/provider 持久化及取消竞态回归。
- 2026-07-12T11:29:37.717Z `node --import tsx --test Composer 与 Provider/Agent 相关测试`: 31/31 通过；覆盖 Provider Registry、事件 reducer、主聊天路由、纯文本限制、附件准备队列和隐私边界。

- 2026-07-12T11:29:37.342Z `npm.cmd run typecheck`: 通过，TypeScript 无类型错误。
- 2026-07-12T11:29:36.958Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过，无 Rust 格式差异。

## Completed

- 2026-07-12T11:29:49.466Z 受控多 Provider 主聊天接入已完成：Claude Code 原链路保持不变；Grok Build 可在新会话选择并锁定，支持文本流、工具/审批/提问事件、取消与 session resume，历史持久化到 SQLite；实验开关和 CLI 可用性共同控制开放。相关前端测试、TypeScript、Rust 测试、生产构建、桌面健康检查与真实 Grok 新建/刷新/续聊均通过。
