# Task: 发布 v0.1.19

## Background

`v0.1.18` 之后已完成 Pi Agent 原生 RPC 接入、热会话、渠道、权限与提问交互、模型和设置体验，
同时修复自动化任务运行隔离、macOS 文件预览与打包类型，以及工作台和普通聊天的若干问题。

## Objective

发布 Pi Agent 渠道与自动化隔离改进，更新 README 和版本元数据，并触发多平台构建

## Scope

In scope:

- 将 npm、Cargo 与 Tauri 版本统一升级到 `0.1.19`。
- README 增加 Pi Agent 支持范围、运行依赖与协议边界说明。
- 验证前端生产构建、Rust 全量测试、格式检查与打包环境。
- 先同步 Gitee `main`，再同步 GitHub `main`，最后推送 GitHub `v0.1.19` tag 触发 Release workflow。

Out of scope:

- 不修改自动更新签名密钥或发布矩阵。
- 不提交 `.claude/settings.local.json`、`.mcp.json` 和未引用的临时图片。
- 不补做需要真实 Pi API Key 的认证运行测试。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 用户文档：`README.md`。
- 发布记录：本任务和对应 Trellis session record。

## Acceptance Criteria

- [x] 所有发布元数据一致为 `0.1.19`。
- [x] README 明确列出 Pi Agent、Node.js 依赖与 Pi MCP 边界。
- [x] 前端测试、生产构建、Rust 格式检查与全量测试通过。
- [x] `package:doctor` 与发布 workflow 回归测试通过。
- [ ] GitHub Release workflow 完成，并生成各平台安装包、签名、`latest.json` 和校验文件。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/agent-channel-selection.test.ts src/hooks/useAgentChannels.test.ts src/lib/automation-run-context.test.ts`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs`
- `git diff --check`

## Implementation Record
- 2026-07-26T14:15:47.659Z 已基于 GitHub origin/main@9cc0fd5 准备 v0.1.19：统一 npm/Cargo/Tauri 版本，README 补充 Pi Agent 原生 RPC、Node.js 依赖和 MCP 边界；明确排除本机配置与临时图片。

- 2026-07-26T14:14:09.346Z Task created by Trellis automation.

## Verification Results
- 2026-07-26T14:18:53.615Z `npm run package:doctor；node --test scripts/release-workflow.test.mjs；git diff --check`: 通过：Doctor OK，发布 workflow 回归测试通过，空白检查无错误。

- 2026-07-26T14:18:52.580Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 格式检查成功；library 225 passed、0 failed、1 ignored，desktop 13 passed，文档测试通过；仅有现有 dead_code 警告。
- 2026-07-26T14:18:51.561Z `node --import tsx --test Pi/渠道/自动化关键测试；npm run build`: 通过：49 项前端测试全部通过，TypeScript 与 Vite 生产构建成功；仅有现有分块大小提示。

## Completion Summary

## Follow-ups

- 真实 Pi 认证运行仍需在提供可用 API Key 的环境中单独验证。
