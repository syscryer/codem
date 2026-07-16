# Task: 发布 v0.1.12

## Background

`v0.1.11` 发布后，主线完成了 Agent 渠道协议兼容、OpenCode 思考事件与历史折叠修复，以及长会话渐进渲染、历史自动分页和持久化降频优化。本次将这些已完成并验证的改动发布为新的补丁版本。

## Objective

发布 Agent 渠道协议修复、思考展示与长会话性能优化的 GitHub v0.1.12 版本

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本统一升级到 `0.1.12`。
- 纳入 `v0.1.11` 之后的 Agent 渠道协议、思考展示和长会话性能优化。
- 版本提交按项目约定先推送 Gitee `main`，再推送 GitHub `main`。
- 基于 GitHub `main` 创建并推送 `v0.1.12` 标签，由 Release workflow 生成各平台安装包、签名、`latest.json` 和校验文件。
- 核对 GitHub Release、自动更新元数据和所有构建任务的最终状态。

Out of scope:

- 不提交 `CONTEXT.md` 和 `Untitled-*.txt` 等本机未跟踪文件。
- 不调整发布矩阵、自动更新签名密钥和安装包结构。
- 不改写已有历史标签。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布记录：`.trellis/tasks/` 与 `.trellis/workspace/sessions/`。
- 远端：Gitee/GitHub `main`、GitHub `v0.1.12` 标签和 Release 资产。

## Acceptance Criteria

- [ ] 所有 CodeM 版本元数据一致为 `0.1.12`。
- [ ] 发布脚本测试、前端全量测试、类型检查、Rust 全量测试、package doctor 和 diff check 通过。
- [ ] 版本提交依次推送到 Gitee 和 GitHub，`v0.1.12` 标签仅推送到 GitHub。
- [ ] GitHub Release workflow 全部成功并生成各平台安装包、签名、`latest.json` 和 `SHA256SUMS.txt`。

## Verification Commands

- `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`
- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `git diff --check`
- 版本一致性检查

## Implementation Record
- 2026-07-16T16:41:48.296Z 已从 Gitee origin/main 快进拉取到 e985b7c，并确认 GitHub main 同步；发布范围为 v0.1.11 后的 Agent 渠道协议、思考展示和长会话性能优化。CodeM 五处版本元数据已统一升级到 0.1.12，历史标签和本机未跟踪文件保持不动。

- 2026-07-16T16:40:53.941Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T16:43:27.678Z `版本一致性检查`: 通过：package、package-lock、Tauri、Cargo.toml 和 CodeM Cargo.lock 均为 0.1.12。

- 2026-07-16T16:43:26.867Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。
- 2026-07-16T16:43:26.040Z `npm run package:doctor`: 通过：Doctor: OK。

- 2026-07-16T16:43:25.218Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 143 项、桌面 main 9 项测试通过，0 失败；1 项需真实 Grok 登录的 smoke test 按设计忽略。
- 2026-07-16T16:43:24.423Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。

- 2026-07-16T16:43:23.666Z `node --import tsx --test src/**/*.test.ts`: 通过：前端 509 项测试全部通过，0 失败。
- 2026-07-16T16:43:22.806Z `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过：10 项发布工作流、资产收集与 latest.json 测试全部通过。

## Completion Summary

## Follow-ups

- GitHub Actions action 主版本升级另行处理，不纳入本次发布。
