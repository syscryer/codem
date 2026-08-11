# Task: Claude 渠道 1M 声明

## Background

Claude Code 通过模型名的 `[1m]` 后缀启用 1M 上下文。系统渠道配置来源是
`~/.claude/settings.json`；安装 CC-Switch 时，其切换结果也会写入同一配置文件。
CodeM 自定义渠道目前可以持久化模型 capabilities，但没有提供 1M 声明入口。

## Objective

从 Claude settings.json 读取系统渠道 1M 标识，并为 CodeM 自定义渠道模型增加简洁的 1M 声明开关

## Scope

In scope:

- 系统 Claude 渠道从 `settings.json` 的 `ANTHROPIC_MODEL` 只读识别 `[1m]`。
- 自定义 Claude 渠道模型提供简洁的“1M”声明开关并持久化。
- 运行时对已声明模型追加 `[1m]`，已有后缀时不重复追加。
- CC-Switch 导入模型时保留已有 `[1m]` 声明。

Out of scope:

- 不增加 200K/1M/自定义 Token 数值选择器。
- 不把系统渠道改为可编辑，也不要求必须安装 CC-Switch。
- 不修改非 Claude Agent 的模型选择和运行行为。

## Impact

- Frontend：渠道模型编辑与 Claude 模型运行参数转换。
- Backend：系统渠道摘要与 CC-Switch 导入能力识别。
- Persistence：复用现有 `agent_channel_models.capabilities_json`，不改数据库结构。

## Acceptance Criteria

- [x] 系统 Claude 渠道能正确展示当前模型是否声明 1M。
- [x] 自定义 Claude 模型可切换 1M 声明，刷新后状态不丢失。
- [x] 声明 1M 的模型实际以且仅以一个 `[1m]` 后缀调用 Claude Code。
- [x] 导入带 `[1m]` 的 CC-Switch 模型后保留声明。
- [x] 非 Claude 渠道不显示该开关且行为不变。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels`
- `cargo test --manifest-path src-tauri/Cargo.toml provider_import`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-11T15:16:42.255Z 已确认并实现最小 1M 声明链路：系统渠道从 settings.json 的 ANTHROPIC_MODEL 识别 [1m]；自定义 Claude 模型复用 capabilities.supportsContext1m；运行时规范化为且仅为一个 [1m] 后缀；CC-Switch 导入保留原始后缀，无数据库迁移。

- 2026-08-11T15:08:44.507Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T15:29:18.636Z `桌面开发模式 + agent-mux-runtime.json 鉴权请求 /api/agents/channels/bootstrap`: 通过；settings.json 被识别，Claude MiniMax-M3 当前为未声明 1M

- 2026-08-11T15:29:17.945Z `git diff --check`: 通过
- 2026-08-11T15:29:17.230Z `npm run build`: Vite 生产构建通过；仅有既有 chunk 大小警告

- 2026-08-11T15:29:16.481Z `npm run typecheck`: 通过
- 2026-08-11T15:29:15.714Z `cargo test --manifest-path src-tauri/Cargo.toml provider_import`: 4 项通过，511 项过滤

- 2026-08-11T15:29:15.033Z `cargo test --manifest-path src-tauri/Cargo.toml agent_channels`: 20 项通过，495 项过滤
- 2026-08-11T15:29:14.369Z `node --import tsx --test src/lib/agent-channel-selection.test.ts`: 24 项通过

## Completion Summary
- 2026-08-11T15:29:19.290Z 完成 Claude 渠道 1M 简化声明：系统渠道只读读取 settings.json 模型后缀并展示状态；自定义 Claude 模型复用 capabilities.supportsContext1m 开关；调用模型统一规范化为单个 [1m] 后缀并立即按 1,000,000 展示上下文；CC-Switch 导入保留原始后缀；无数据库迁移，非 Claude 行为不变。聚焦测试、类型检查、构建、桌面启动验证均通过。

## Follow-ups

- 暂无；只有 Claude Code 后续不再使用 `[1m]` 约定时才需要调整识别方式。
