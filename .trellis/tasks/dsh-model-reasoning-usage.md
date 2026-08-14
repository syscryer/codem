# Task: 接入 DSH 模型推理与用量数据

## Background

DSH Web Host 已提供模型目录、会话模型切换、消息级 usage 与会话 projection 数据，CodeM 需要把这些数据接入统一 Composer 和历史记录，而不是复制 DSH Web UI。

## Objective

将 DSH Web API 的模型目录、推理等级、上下文用量和运行统计接入 CodeM 统一会话体验

## Scope

In scope:

- 从 `llm.models` 动态读取模型与推理等级。
- 使用 `session.select-model` 应用模型和推理等级。
- 映射消息级 token usage 与 projection 上下文、分项和运行统计。
- 在统一上下文弹层展示数据并保留历史恢复能力。

Out of scope:

- 复制 DSH Web 聊天界面。
- 展示模型隐藏思维链或新增独立统计页面。

## Impact

- `src-tauri/src/dsh.rs`、`src-tauri/src/agent_run.rs`、`src-tauri/src/agent_runtime.rs`
- `src/types.ts`、`src/lib/conversation.ts`、`src/lib/composer-context-usage.ts`
- `src/components/Composer.tsx`、`src/components/ComposerContextIndicator.tsx`

## Acceptance Criteria

- [x] DSH 模型菜单显示 Web Host 返回的真实模型。
- [x] 推理等级按模型显示并随运行请求生效。
- [x] 单轮 token 与累计上下文数据不会互相覆盖。
- [x] 上下文分项和运行统计进入统一上下文弹层。
- [x] 前端构建、定向前端测试、Rust 检查与 DSH 测试通过。

## Verification Commands

- `cargo check -q`
- `cargo test dsh_ -- --nocapture`
- `npm.cmd run build`
- `node --import tsx --test src/lib/composer-context-usage.test.ts`
- `git diff --check`

## Implementation Record
- 2026-08-14T02:13:17.461Z 确认 DSH Web 正式 RPC 方法名为 session.selectModel；旧实现使用 session.select-model 导致 Host 返回 404 text/plain，现已修正并通过 9 项 DSH 测试。

- 2026-08-14T01:38:12.997Z 修复 DSH 旧会话模型兼容：select_model 遇到裸模型名时读取 llm.models，按模型 ID 唯一匹配 provider；完整 provider/model 直接透传。
- 2026-08-14T01:23:19.892Z 补充 DSH 会话投影只读接口；已有 DSH 会话缺少 contextUsage 时自动读取 session.history(includeProjections=true)，合并到最后一轮并持久化。

- 2026-08-13T17:28:52.747Z 已接入 DSH Web Host 动态模型目录、session.select-model 模型与推理等级选择、消息级 usage、projection 上下文分项和运行统计；统一 Composer 展示并保留历史合并语义。
- 2026-08-13T16:58:00.563Z 需求范围确认：复用 CodeM 统一 Composer 模型/推理菜单和 usage 事件，不复制 DSH Web UI；模型及推理选择随会话持久化，运行数据来自 DSH 官方事件与接口。

- 2026-08-13T16:58:00.287Z Task created by Trellis automation.

## Verification Results
- 2026-08-14T02:18:34.293Z `桌面开发重启与 Agent Mux 二进制检查`: codem-agent-mux 已重建，session.selectModel 存在，旧 session.select-model 不存在

- 2026-08-14T02:18:34.030Z `CodeM /api/agents/run 真实 DSH 会话`: deepseek-v4-flash/high 返回 DSH_OK；session ready；usage 8009/19，上下文 8037/1000000
- 2026-08-14T02:18:33.764Z `cargo check -q --manifest-path src-tauri/Cargo.toml`: 通过，仅既有 dead_code 警告

- 2026-08-14T02:18:33.501Z `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 9 项 DSH 定向测试通过
- 2026-08-14T01:38:13.776Z `桌面开发热重启`: target/debug/codem.exe 已于 09:32:25 重新启动

- 2026-08-14T01:38:13.517Z `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 9 项 DSH 测试通过，包含裸模型解析和完整模型透传
- 2026-08-14T01:38:13.259Z `cargo check -q --manifest-path src-tauri/Cargo.toml`: 通过，仅既有 dead_code 警告

- 2026-08-14T01:23:21.185Z `CodeM Dev 真实会话回填`: session-855943e2 已写入 25876/1000000 及系统提示词、工具、对话消息、运行统计
- 2026-08-14T01:23:20.917Z `npm.cmd run build`: TypeScript 与 Vite 生产构建通过

- 2026-08-14T01:23:20.668Z `node --import tsx --test src/lib/settings-api.test.ts src/lib/composer-context-usage.test.ts`: 24 项测试通过
- 2026-08-14T01:23:20.410Z `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 7 项 DSH 测试通过

- 2026-08-14T01:23:20.154Z `cargo check -q --manifest-path src-tauri/Cargo.toml`: 通过，仅既有 dead_code 警告
- 2026-08-13T17:28:54.088Z `git diff --check`: 通过，仅提示工作区 CRLF 转换警告

- 2026-08-13T17:28:53.814Z `node --import tsx --test src/lib/composer-context-usage.test.ts`: 通过，11 个上下文用量测试全部成功
- 2026-08-13T17:28:53.547Z `npm.cmd run build`: 通过，TypeScript 与 Vite 生产构建成功；仅有既有 chunk 警告

- 2026-08-13T17:28:53.280Z `cargo test dsh_ -- --nocapture`: 通过，7 个 DSH 定向测试全部成功
- 2026-08-13T17:28:53.015Z `cargo check -q`: 通过，仅有仓库既有 dead_code 警告

## Completion Summary

- 2026-08-14T02:18:34.552Z 修复 DSH 模型切换 RPC 路由名并重启桌面开发版；真实 CodeM 会话、流式回复、usage 与上下文投影均验证通过。
- 2026-08-14T01:38:14.035Z DSH 旧会话保存的 deepseek-v4-flash 可自动解析为 deepseek-official/deepseek-v4-flash，后续发送不再报 provider/model 格式错误。

- 2026-08-14T01:23:21.452Z DSH 上下文小圈支持旧会话自动补拉原生投影；当前真实会话已回填并持久化，桌面开发版已重启。
- 2026-08-13T17:28:54.349Z 完成 DSH 真实模型、推理等级、上下文用量分项与运行统计接入，并通过前后端构建和定向测试。

## Follow-ups

- 由用户在桌面开发模式中手工验证真实 DSH 会话的模型切换与统计展示。
