# Task: 修复 Kimi 渠道与 CLI 更新

## Background

Kimi Code 已接入 Agent 管理，但渠道后端未把 `kimi-code` 纳入 Provider 白名单、协议矩阵、系统渠道和运行时构建，导致设置页保存或获取模型时报“不支持的 Agent”。同时，本机 PATH 优先命中官方独立安装的 `~/.kimi-code/bin/kimi.exe`（0.39.1），现有更新流程却只更新 npm 全局包（已到 0.41.0），因此界面更新成功后实际运行版本不变。

## Objective

补齐 Kimi 自定义渠道完整链路，并修复 CLI 无法更新到 npm latest

## Scope

In scope:

- 补齐 Kimi 自定义渠道的保存、默认选择、系统配置识别、模型发现和运行时环境注入。
- 按 Anthropic Messages、OpenAI Chat、OpenAI Responses 映射 Kimi 官方 `KIMI_MODEL_PROVIDER_TYPE`。
- 识别官方独立安装版 Kimi，并使用官方 installer 更新；npm 安装版继续使用对应包管理器更新。
- 修复 Kimi 图片 print 路径中临时图片未清理、内联文件正文被丢弃的问题。
- 增加回归测试并在桌面开发运行时实测渠道接口和 CLI 版本。

Out of scope:

- 改写 Kimi CLI 自身的模型接口兼容逻辑。
- 修复本轮审查发现但与 Kimi 无关的其他 Provider 问题。
- 自动保存或在日志、测试夹具中固化用户 API Key。

## Impact

- 后端渠道注册、运行时环境、系统配置摘要与 Agent 生命周期更新计划。
- Kimi 图片消息的一次性 print 执行路径。
- 桌面开发壳需要重启以加载新的 mux 后端。

## Acceptance Criteria

- [x] Kimi 渠道可保存、测试连接和获取模型，不再返回“不支持的 Agent”。
- [x] 三种受支持协议均生成正确的 `KIMI_MODEL_*` 环境，且密钥不写入运行时配置文件。
- [x] Kimi 系统渠道能从 `~/.kimi-code/config.toml` 读取默认模型、地址和协议，不读取或返回 API Key。
- [x] 官方独立安装版 Kimi 更新走官方 installer，实际 PATH 命中的版本更新到当前 latest（验证时为 0.41.0）。
- [x] base64 临时图片在成功、失败或取消后清理；内联文件正文进入 Kimi print 提示词。
- [x] 相关 Rust 测试、格式检查和前端类型检查通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml backend::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `npm run typecheck`
- 桌面 dev 重启后调用 `/api/agents/channels`、`/api/agents/lifecycle` 并核对 `kimi --version`

## Implementation Record
- 2026-09-05T03:10:08.395Z Kimi 系统配置只读取 ~/.kimi-code/config.toml 的模型、地址和协议元数据，不读取或序列化 api_key。

- 2026-09-05T03:10:07.552Z 确认 kimi update 在 Windows 非交互环境只返回手动提示；改用官方 install.ps1/install.sh，并显式恢复内置 PowerShell 模块路径，避免 Get-FileHash 解析失败。
- 2026-09-05T03:10:06.722Z 补齐 Kimi 渠道白名单、系统配置、三协议运行时；修复自定义渠道模型目录按 channelId 注入环境，以及 print 附件语义和临时图片清理。

- 2026-09-04T14:48:43.379Z Task created by Trellis automation.

## Verification Results
- 2026-09-05T03:10:19.583Z `live mux: Kimi system ACP catalog=7; Sensenova discover=8; lifecycle update=0.41.0`: pass

- 2026-09-05T03:10:18.746Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: pass
- 2026-09-05T03:10:17.922Z `npm run typecheck && npm run build`: pass

- 2026-09-05T03:10:17.068Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: pass (117 passed)
- 2026-09-05T03:10:16.236Z `cargo test --manifest-path src-tauri/Cargo.toml backend::tests`: pass (181 passed)

- 2026-09-05T03:10:15.403Z `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`: pass (23 passed)
- 2026-09-05T03:10:14.575Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass

## Completion Summary
- 2026-09-05T03:12:27.142Z Kimi 渠道白名单、系统配置、三协议运行时和自定义渠道模型目录已补齐；Kimi 原生安装更新改用官方 installer 并兼容 Windows PowerShell 非交互环境；print 图片与内联文件附件语义已修复。验证通过：onboarding gate、Rust agent_channels 23/backend 181/agent_run 117、fmt、typecheck/build；桌面实测 Kimi 目录 7 个模型、Sensenova 发现 8 个模型且连接成功、Kimi 版本 0.41.0。

## Follow-ups

- 用户已在聊天中公开 API Key，验收后应在服务端轮换。
