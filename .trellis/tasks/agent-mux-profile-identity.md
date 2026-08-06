# Task: Agent Mux 配置昵称与内置图标

## Background

Agent Mux 当前只能用 Agent 类型、供应商和模型识别运行配置。用户希望可选地为具体配置设置昵称，并从现有内置动物图标中选择头像，便于区分同一 Agent 下的多个供应商与模型组合。

## Objective

为 Agent Mux 运行配置增加可选昵称和内置图标，并贯通配置持久化、Skill 发现、运行快照、运行监控、会话上下文岛和聊天调用组。

## Scope

In scope:

- 配置抽屉增加可选昵称输入和内置动物图标选择。
- SQLite profile 增量字段保存昵称和图标标识。
- 创建运行时保存昵称和图标快照，历史运行不受后续配置修改或删除影响。
- Agent Mux 页面、运行选择、监控、上下文岛和聊天调用组统一优先展示昵称。
- Tooltip 保留真实 Agent、供应商和模型信息。
- 外部 Skill 的 agents/status JSON 返回昵称和图标标识。
- 旧配置和旧运行缺少字段时保持当前显示，并使用 Agent 官方图标。

Out of scope:

- 上传本地图片、网络图片 URL、图片裁剪和文件清理。
- 每次调用临时命名、随机生成昵称或图标。
- Claude/Codex 原生子代理命名。

## Impact

- Frontend: `src/lib/agent-mux-api.ts`、Agent Mux 配置与监控、会话调用展示。
- Backend: `src-tauri/src/agent_mux.rs` 的 API contract、SQLite 增量列与验证。
- CLI/Skill: `src-tauri/src/bin/codem-agent-mux.rs` 创建运行快照；Skill 文本自动包含最新字段。

## Acceptance Criteria

- [x] 昵称和内置图标均为可选，刷新和重启后保持。
- [x] 未配置昵称或图标时，保留原名称并显示 Agent 官方图标。
- [x] 同一 Agent 的不同配置可用昵称和图标区分。
- [x] 新运行保存身份快照，修改配置后历史运行仍显示原身份。
- [x] 运行监控、上下文岛、聊天调用组和 Skill JSON 字段一致。
- [x] 昵称长度、空白归一化和图标白名单在后端校验。
- [x] 前端、Rust、CLI、构建及桌面交互验收通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-mux-ui.test.ts src/lib/conversation-context-prototype.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend --bin codem-agent-mux`
- Agent Mux CLI 真实发现/调用与桌面宽窄布局验收。

## Implementation Record
- 2026-08-06T02:02:43.512Z Agent Mux 运行配置已贯通可选昵称与内置头像：默认显示 Agent 官方图标，头像通过统一 Popover 下拉选择；配置与运行记录保存身份快照，Skill、监控、上下文岛和聊天调用组优先展示昵称。

- 2026-08-06T01:35:38.045Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T02:16:56.950Z `codem-agent-mux agents/status/invoke --app-data CodeM Dev`: 真实发现包含 nickname/avatar；真实调用返回 AGENT_MUX_IDENTITY_OK，运行快照字段存在
- 2026-08-06T02:16:56.580Z `npm run build && cargo fmt --check && cargo check --bin codem-backend --bin codem-agent-mux`: 前端构建、Rust 格式和双入口检查通过

- 2026-08-06T02:16:56.223Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux && cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: Agent Mux 15 项、CLI 4 项全部通过
- 2026-08-06T02:16:55.857Z `node --import tsx --test src/lib/agent-mux-ui.test.ts src/lib/conversation-context-prototype.test.ts`: 20 项全部通过

- 前端源码与交互合同测试 20/20 通过。
- Agent Mux 后端测试 15/15、独立 CLI 测试 4/4 通过。
- TypeScript/Vite 构建、Rust fmt 与双入口 check 通过。
- 独立 CLI 真实发现返回 `nickname` / `avatar`；真实调用返回 `AGENT_MUX_IDENTITY_OK`，最新运行快照包含两个身份字段。

## Completion Summary
- 2026-08-06T02:17:37.023Z 完成 Agent Mux 可选昵称与内置头像闭环：头像使用紧凑下拉，默认显示 Agent 官方图标；身份字段贯通配置、SQLite、Skill/CLI、运行快照、监控、上下文岛和聊天调用组，并通过前端、Rust、CLI、构建及真实调用验证。

Agent Mux 运行配置现可选填昵称，并通过紧凑的 Popover 下拉选择一个内置动物图标。未选择时显示 Agent 官方图标。身份字段已贯通 SQLite、Skill/CLI、运行快照、监控、上下文岛和聊天调用组。

## Follow-ups

- 无。
