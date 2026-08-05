# Task: Agent Mux OpenCode、原始提示词与运行跳转

## Background

Agent Mux 当前只初始化 Codex、Claude Code、Grok Build 与 Pi Agent，已接入 CodeM 的 OpenCode 没有出现在 Agent 配置列表。Agent 类型详情存在无动作的“更多”按钮；运行记录又复用 `summary` 暂存调用提示词，任务完成后该字段会被结果摘要覆盖，导致运行详情无法恢复原始提示词。概览页的主 Agent 调用行带有右箭头，但整行不可点击。

## Objective

补全 OpenCode Agent 类型，持久化并展示调用原始提示词，支持从概览跳转到运行详情，移除无效更多按钮

## Scope

In scope:

- Agent catalog 增量补入 OpenCode，并允许使用 OpenCode 对应的系统渠道、自定义渠道、模型目录和真实连接检测。
- 为 `agent_mux_runs` 新增不可被完成摘要覆盖的原始 `prompt` 字段，贯通 CodeM 内调用、外部 Skill CLI 调用、SQLite 和前端类型。
- 运行详情顶部显示原始调用提示词；旧记录明确提示未保存原始提示词。
- 概览调用行点击后切换到运行监控并选中对应 run。
- 删除无实际动作的 Agent 类型“更多”按钮。

Out of scope:

- 不改变 Agent 公开事件解析、聊天渲染器和输出日志持久化协议。
- 不扩大 Agent Mux 独立执行范围；OpenCode 只进入配置、检测和发现目录，独立调用仍遵守现有 Runtime 支持边界。
- 不新增 Agent 类型删除、重命名或批量操作菜单。

## Impact

- Frontend: `src/components/AgentMuxPrototype.tsx`、`src/lib/agent-mux-api.ts`、Agent Mux 样式与回归测试。
- Backend: `src-tauri/src/agent_mux.rs` 的 SQLite schema、run contract、catalog 初始化和测试。
- Runtime CLI: `src-tauri/src/bin/codem-agent-mux.rs` 创建外部运行记录时写入原始提示词。
- Privacy: 原始提示词只写入本机 CodeM SQLite；不进入 trace，不复制渠道密钥。
- Compatibility: 旧数据库通过增量列迁移获得空 prompt，既有运行记录保持可读。

## Acceptance Criteria

- [x] 既有四类 Agent 的数据库升级后会增量出现 OpenCode，不要求清空数据库。
- [x] OpenCode 配置抽屉只展示 OpenCode 对应渠道与模型，连接测试复用真实 OpenCode ACP probe。
- [x] CodeM 内运行和外部 Skill 调用都保存完整原始提示词，完成/失败摘要更新不会覆盖它。
- [x] 运行详情顶部展示“调用提示词”，旧记录展示明确的未保存说明。
- [x] 概览调用行可点击、可键盘聚焦，并打开对应运行监控详情。
- [x] Agent 类型详情不再展示无功能的“更多”按钮。
- [x] 类型检查、相关 Node 测试、Rust Agent Mux 测试、格式检查和前端构建通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/agent-mux-events.test.ts src/lib/markdown-content-integration.test.ts src/lib/agent-mux-ui.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run build`

## Implementation Record
- 2026-08-05T09:23:27.483Z 完成 OpenCode 类型接入、原始提示词持久化与展示、概览运行跳转、无效更多按钮移除，并修复概览健康状态只显示前四类 Agent 的截断。

- 2026-08-05T07:12:29.333Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T09:23:43.322Z `Agent Mux 外部 Skill 真实调用与 Playwright UI 验收`: 通过，返回 PROMPT_FIELD_STORED_OK；运行详情读回完整提示词；900x800 下 OpenCode 第五行完整可见。
- 2026-08-05T09:23:42.613Z `npm run build`: 通过，Vite 生产构建完成，仅有既有 chunk size 与动态导入警告。

- 2026-08-05T09:23:41.939Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过，Rust 格式检查无差异。
- 2026-08-05T09:23:41.243Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`: 通过，13 项 Agent Mux Rust 测试通过。

- 2026-08-05T09:23:40.489Z `node --import tsx --test src/lib/agent-mux-events.test.ts src/lib/markdown-content-integration.test.ts src/lib/agent-mux-ui.test.ts`: 通过，7 项测试全部通过。
- 2026-08-05T09:23:39.781Z `npm run typecheck`: 通过，TypeScript project references 无错误。

- `npm run typecheck`: 通过。
- `node --import tsx --test src/lib/agent-mux-ui.test.ts src/lib/agent-mux-events.test.ts src/lib/agent-run-events.test.ts src/lib/api-fetch-bridge.test.ts`: 19 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`: 13 项通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。
- `npm run build`: 通过，仅保留既有 chunk size 与动态导入警告。
- 外部 Skill 真实调用返回 `PROMPT_FIELD_STORED_OK`，CLI 状态与运行监控详情均读回完整原始提示词。
- 900x800 视口下 Agent 健康状态完整显示第五条 OpenCode。

## Completion Summary
- 2026-08-05T09:23:52.849Z Agent Mux 已补齐 OpenCode 配置入口、原始提示词持久化与运行详情展示、概览调用跳转和健康列表完整展示；无功能更多按钮已移除，自动化检查与真实外部 Skill 调用验收均通过。

- 补齐 OpenCode 配置目录、真实渠道/模型筛选和 ACP 检测。
- 原始提示词贯通 CodeM、外部 Skill CLI、SQLite 与运行详情，旧记录保持兼容。
- 概览调用行支持点击和键盘跳转，删除无功能“更多”按钮。
- 概览健康状态不再截断前四类 Agent。

## Follow-ups

- OpenCode 的 Agent Mux 独立执行支持需要单独确认 ACP Runtime 生命周期、人工输入与取消行为后再接入。
