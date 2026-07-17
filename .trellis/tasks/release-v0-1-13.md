# Task: 发布 v0.1.13

## Background

`v0.1.12` 发布后，主线完成了 Claude 安装状态检测刷新，以及长任务流式输出、长会话历史持久化与渲染性能优化。本次将这些已完成的修复发布为新的补丁版本。

## Objective

从已同步的 main 基线发布 CodeM v0.1.13，完成版本同步、质量门禁、双远端推送和 GitHub Release 产物核验

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本统一升级到 `0.1.13`。
- 纳入 `v0.1.12` 之后的 Claude 安装检测与长任务性能修复。
- 版本提交按项目约定先推送 Gitee `main`，再推送 GitHub `main`。
- 基于 GitHub `main` 创建并推送 `v0.1.13` 标签，由 Release workflow 生成各平台安装包、签名、`latest.json` 和校验文件。
- 核对 GitHub Release、自动更新元数据和所有构建任务的最终状态。

Out of scope:

- 不提交 `CONTEXT.md` 和 `Untitled-*.txt` 等本机未跟踪文件。
- 不调整发布矩阵、自动更新签名密钥和安装包结构。
- 不改写已有历史标签。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布记录：`.trellis/tasks/` 与 `.trellis/workspace/sessions/`。
- 远端：Gitee/GitHub `main`、GitHub `v0.1.13` 标签和 Release 资产。

## Acceptance Criteria

- [x] 所有 CodeM 版本元数据一致为 `0.1.13`。
- [x] 发布脚本测试、前端全量测试、类型检查、Rust 全量测试、package doctor 和 diff check 通过。
- [x] 版本提交依次推送到 Gitee 和 GitHub，`v0.1.13` 标签仅推送到 GitHub。
- [x] GitHub Release workflow 全部成功并生成各平台安装包、签名、`latest.json` 和 `SHA256SUMS.txt`。

## Verification Commands

- `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`
- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `git diff --check`
- 版本一致性检查

## Implementation Record

- 2026-07-17T06:08:42.768Z GitHub Actions 继续报告 actions/*@v4 的 Node.js 20 弃用提示，runner 已强制使用 Node.js 24，本次构建与发布不受影响；按任务边界留待后续升级 action 主版本。
- 2026-07-17T05:50:10.388Z 已确认本地、Gitee origin/main 与 GitHub github/main 均指向 5afc145，最新正式版为 v0.1.12；本次发布范围为 Claude 安装检测刷新与长任务性能修复，五处版本元数据已统一升级到 0.1.13，未跟踪临时文件保持不动。

- 2026-07-17T05:49:29.027Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T06:08:47.006Z `remote refs`: 通过：Gitee main、GitHub main 和 GitHub v0.1.13 均指向发布提交 6057c86。

- 2026-07-17T06:08:45.920Z `GitHub latest.json`: 通过：version=0.1.13，windows-x86_64、darwin-aarch64、linux-x86_64 均指向 v0.1.13 签名资产。
- 2026-07-17T06:08:44.889Z `GitHub Release v0.1.13 assets`: 通过：正式版非草稿、非预发布，包含 19 个资产，Windows EXE/MSI/portable、macOS DMG/app、Linux AppImage/deb/rpm、updater 签名、源码包、latest.json 和 SHA256SUMS.txt 齐全。

- 2026-07-17T06:08:43.802Z `GitHub Actions run 29558533206`: 通过：macOS arm64 8 分 12 秒、Linux x64 10 分 10 秒、Windows x64 13 分 9 秒及 Publish GitHub Release 全部 success。
- 2026-07-17T05:52:23.190Z `版本一致性检查`: 通过：package、package-lock、Tauri、Cargo.toml 和 CodeM Cargo.lock 均为 0.1.13。

- 2026-07-17T05:52:22.134Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。
- 2026-07-17T05:52:21.188Z `npm run package:doctor`: 通过：Doctor: OK。

- 2026-07-17T05:52:20.124Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 147 项、桌面 main 9 项测试通过，0 失败；1 项需真实 Grok 登录的 smoke test 按设计忽略。
- 2026-07-17T05:52:19.182Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。

- 2026-07-17T05:52:18.111Z `node --import tsx --test src/**/*.test.ts`: 通过：前端 513 项测试全部通过，0 失败。
- 2026-07-17T05:52:17.122Z `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过：10 项发布工作流、资产收集与 latest.json 测试全部通过。

## Completion Summary
- 2026-07-17T06:09:04.691Z 已完成 CodeM v0.1.13 发布；发布提交 6057c86 已同步 Gitee/GitHub，Windows、macOS、Linux 构建及 Release 发布全部通过，19 个安装、签名、源码、latest.json 和校验资产齐全。

## Follow-ups

- GitHub Actions action 主版本升级另行处理，不纳入本次发布。
