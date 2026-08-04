# Task: DeepSeek Responses 渠道适配

## Background

DeepSeek 已为 `deepseek-v4-flash` 提供 OpenAI Responses 接口。当前 CodeM 的 DeepSeek
厂商预设仅展示 OpenAI Chat 和 Anthropic，且新版 Codex CLI 已移除 `wire_api = "chat"`，
导致使用 DeepSeek Chat 渠道启动 Codex App Server 时子进程立即退出。CodeM 同时丢弃了
该子进程的 stderr，界面只能看到“stdout 已关闭”，无法定位真实配置错误。

## Objective

为 DeepSeek 增加 Responses 模板，适配 Codex/OpenCode/Pi/Grok/普通聊天，并改进 Codex App Server 错误提示后完成 Windows 打包验证

## Scope

In scope:

- 新增 DeepSeek OpenAI Responses 厂商模板，保持官方 Base URL。
- Codex 渠道仅允许 Responses，并迁移可明确识别的 DeepSeek V4 Flash Chat 渠道。
- OpenCode 增加 Responses 运行适配；Pi、Grok、普通聊天复用共享模板。
- DeepSeek Responses 明确限制当前支持模型为 `deepseek-v4-flash`。
- Codex App Server 保留有界 stderr，并在 stdout 提前关闭时返回脱敏后的真实错误。
- 补充协议矩阵、模板、迁移、运行配置和错误信息测试，完成 Windows 本地打包。

Out of scope:

- Claude CLI 首次安装在受限地区下载到 HTML 的问题，后续单独修复。
- 自动迁移无法确认上游支持 `/responses` 的其他 Codex 自定义 Chat 渠道。
- DeepSeek 尚未声明支持 Responses 的其他模型。

## Impact

- 前端 Agent 渠道模板和协议选项。
- 后端 Agent 渠道校验、迁移及 Codex/OpenCode 运行配置。
- 普通聊天厂商模板。
- Codex App Server 子进程错误诊断。

## Acceptance Criteria

- [x] DeepSeek 厂商预设展示 OpenAI Responses，普通聊天可直接选择。
- [x] Codex 仅展示和接受 Responses；已存在的 DeepSeek V4 Flash Chat 渠道自动迁移。
- [x] OpenCode 可生成使用 `@ai-sdk/openai` 的 Responses 渠道配置。
- [x] Pi、Grok 可通过 DeepSeek Responses 模板建渠道。
- [x] DeepSeek Responses 选择非 `deepseek-v4-flash` 时返回明确错误。
- [x] Codex App Server 提前退出时，界面错误包含有界、脱敏后的 stderr 详情。
- [x] 相关前后端测试、类型检查和 Windows 打包通过。

## Verification Commands

- `node --test --import tsx "src/**/*.test.ts"`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels`
- `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server`
- `npm run package:doctor`
- `npm run package:win`

## Implementation Record
- 2026-08-04T07:41:25.339Z 已新增 DeepSeek Responses 模板；Codex 仅允许 Responses 并迁移 DeepSeek V4 Flash Chat 渠道；OpenCode 使用 @ai-sdk/openai；普通聊天与 Agent 运行时限制官方 DeepSeek Responses 当前仅支持 deepseek-v4-flash；Codex App Server 捕获 8KiB stderr 尾部。

- 2026-08-04T07:27:20.258Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T07:50:39.255Z `npm run package:win`: pass: NSIS and MSI bundles generated
- 2026-08-04T07:44:33.264Z `cargo test --manifest-path src-tauri/Cargo.toml`: partial: 416 passed, 1 ignored, 1 known unrelated failure in claude_delayed_fork_real_process_init_binds_before_exit

- 2026-08-04T07:44:32.563Z `npm run package:doctor`: pass
- 2026-08-04T07:44:31.847Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`: pass: 18 passed

- 2026-08-04T07:44:31.130Z `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server`: pass: 41 passed
- 2026-08-04T07:44:30.383Z `cargo test --manifest-path src-tauri/Cargo.toml agent_channels`: pass: 14 passed

- 2026-08-04T07:44:29.682Z `npm run typecheck`: pass
- 2026-08-04T07:44:29.002Z `node --test --import tsx "src/**/*.test.ts"`: pass: 725 passed

## Completion Summary
- 2026-08-04T07:52:01.598Z 完成 DeepSeek Responses 模板、Codex/OpenCode/Pi/Grok/普通聊天协议适配、Codex stderr 诊断与 Windows NSIS/MSI 打包验证；相关测试通过，完整 Rust 套件仅保留一个已知无关 Claude fork 测试失败。

DeepSeek 标准 API 已新增 Responses 模板并覆盖普通聊天及支持该协议的 Agent。Codex
渠道已收敛为 Responses，明确迁移官方 DeepSeek V4 Flash 旧 Chat 配置；OpenCode 使用
OpenAI SDK 运行 Responses。Codex App Server 会保留 8KiB stderr 尾部，并通过现有公开
错误脱敏后展示真实退出原因。前端 725 项、相关 Rust 73 项、类型检查和 Windows
NSIS/MSI 打包均通过。完整 Rust 套件仍有仓库既有的 Claude fork 真实进程测试失败，
该问题已在 `provider-file-change-parity` 任务中记录，与本次改动无关。

## Follow-ups

- 单独修复无 npm 环境下 Claude 首次安装下载到地区限制 HTML 的错误分类和代理重试。
