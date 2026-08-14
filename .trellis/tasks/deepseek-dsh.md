# Task: 接入 DeepSeek DSH Agent

## Background

CodeM 已支持多种本地 Agent，但尚未接入 DeepSeek 官方 DSH。用户确认采用独立 Headless 进程方案，并要求同时覆盖安装、渠道、运行和专属设置。

## Objective

按 Hermes 现有模式，将 DSH 纳入 Agent Provider、安装检测、运行调用和 Agent 设置，并完成本地验证

## Scope

In scope:

- 新增 DeepSeek DSH Provider、图标、安装、更新、版本检测和诊断。
- 使用 DSH Headless Profile 执行 CodeM 聊天任务，并支持停止子进程。
- 将 CodeM DeepSeek 渠道的 API Key、Base URL 和模型注入 DSH 运行环境。
- 增加 DSH Profile、工具模式、权限映射和 Web Agent 预设说明。

Out of scope:

- 不伪造 DSH 尚未公开的 ACP 或流式协议。
- 不把 DSH Web 的 standard/code/minimal/cordis 预设当作 Headless CLI 参数。
- 不修改或接管用户现有 `.dsh` 配置和凭据。

## Impact

- frontend：Agent 设置、Provider 元数据、渠道和运行请求。
- backend：Provider Registry、CLI 管理、渠道协议和独立 DSH 进程执行。

## Acceptance Criteria

- [x] 设置页可检测、安装和更新 `@deepseek-ai/dsh`。
- [x] DSH 仅允许兼容的 OpenAI Chat 渠道，并注入 DeepSeek 环境变量。
- [x] CodeM 可启动 Headless 任务、回填最终输出并强制停止子进程。
- [x] 自定义模型通过一次性 Patch 注入，不改写用户 DSH 配置。
- [x] Agent 设置展示 DSH 专属 Profile、工具模式、权限和 Web 预设。

## Verification Commands

- `npm.cmd run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
- DSH Provider、渠道和运行相关定向测试

## Implementation Record
- 2026-08-13T14:08:57.421Z 完成 DeepSeek DSH Provider、安装更新检测、OpenAI Chat 渠道、Headless 独立进程运行、专属 Agent 设置和 README 文档；修复 DSH 未加入新建聊天后端白名单的问题。

- 2026-08-13T13:11:53.011Z Task created by Trellis automation.
- 参考 DeepSeek Harness 官方源码确认 npm 包仅公开 `headless` 与 `web` Profile，Headless 当前只输出最终答案。
- DSH 使用独立子进程执行，不进入 CodeM 热会话 Actor；CodeM 继续管理历史、队列和停止。
- 渠道模型使用运行级临时 Patch，结束、取消或启动失败后删除。

## Verification Results
- 2026-08-13T14:08:58.264Z `DSH 定向测试与真实 Runtime API`: 权限映射、模型 Patch、Provider Registry、渠道协议测试通过；真实 Runtime 检测 dsh 0.1.0-rc.6，诊断 exitCode=0，新建 DSH 聊天返回 HTTP 200。

- 2026-08-13T14:08:57.988Z `cargo test --manifest-path src-tauri/Cargo.toml --no-run`: 通过，Rust 全部测试目标编译成功；仅有仓库原有 dead_code 警告。
- 2026-08-13T14:08:57.707Z `npm.cmd run build`: 通过，TypeScript 与 Vite 构建成功；仅有仓库原有 chunk 警告。

## Completion Summary
- 2026-08-13T14:08:58.544Z DeepSeek DSH 已按 Headless 方案完整接入 CodeM，桌面开发模式已重启并完成真实接口验收。

## Follow-ups

- 若 DSH 后续正式提供 ACP 或流式事件协议，再评估替换 Headless 最终输出桥接。
