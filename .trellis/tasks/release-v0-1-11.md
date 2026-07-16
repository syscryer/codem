# Task: 发布 v0.1.11

## Background

`v0.1.10` 发布后，主线完成了旧 Node 后端清理、Rust 后端能力补齐、Agent 渠道管理、版本探测、模型偏好、会话交互和弹层体验优化。本次将这些已完成并验证的主线改动发布为新的补丁版本。

## Objective

发布包含 Rust 后端清理、Agent 管理与会话体验改进的 GitHub v0.1.11 版本

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本统一升级到 `0.1.11`。
- 基于 GitHub `main` 当前提交创建并推送 `v0.1.11` 标签。
- 由 GitHub Release workflow 构建 Windows、macOS、Linux 安装产物、更新签名、`latest.json` 和校验文件。
- 核对 GitHub Release 和所有构建任务的最终状态。

Out of scope:

- 不提交 `CONTEXT.md` 和 `Untitled-*.txt` 等本机未跟踪文件。
- 不调整发布矩阵、自动更新签名密钥和安装包结构。
- 不向 Gitee 推送本次发布提交或标签。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布记录：`.trellis/tasks/` 与 `.trellis/workspace/sessions/`。
- GitHub：`main` 分支、`v0.1.11` 标签、Release workflow 和 Release 资产。

## Acceptance Criteria

- [x] 所有 CodeM 版本元数据一致为 `0.1.11`。
- [x] 发布脚本测试、前端类型检查、Rust 测试、package doctor 和 diff check 通过。
- [x] 版本提交和 `v0.1.11` 标签仅推送到 GitHub。
- [x] GitHub Release workflow 全部成功并生成各平台安装包、签名、`latest.json` 和 `SHA256SUMS.txt`。

## Verification Commands

- `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `git diff --check`
- 版本一致性检查

## Implementation Record

- 2026-07-16T08:07:11.041Z GitHub Actions 对 actions/checkout@v4、setup-node@v4、upload/download-artifact@v4 和 softprops/action-gh-release@v2 报告 Node.js 20 弃用提示，当前已由 runner 强制使用 Node.js 24 且不影响本次发布；后续单独升级 action 主版本消除警告。
- 2026-07-16T07:32:47.889Z 确认以 GitHub main@2206d4b 为发布基线，将 CodeM 版本元数据统一升级到 0.1.11；发布仅推送 GitHub，不纳入本机未跟踪临时文件，也不修改第三方 matches 0.1.10 依赖。

- 2026-07-16T07:30:25.950Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T08:07:10.150Z `GitHub remote refs`: 通过：main 和 v0.1.11 均指向发布提交 1e2123e，Gitee 未推送。
- 2026-07-16T08:07:09.243Z `GitHub latest.json`: 通过：version=0.1.11，windows-x86_64、darwin-aarch64、linux-x86_64 均指向 v0.1.11 签名资产。

- 2026-07-16T08:07:08.271Z `GitHub Release v0.1.11 assets`: 通过：正式版包含 19 个资产，Windows EXE/MSI/portable、macOS DMG/app、Linux AppImage/deb/rpm、updater 签名、源码包、latest.json 和 SHA256SUMS.txt 齐全。
- 2026-07-16T08:07:07.299Z `GitHub Actions run 29481422339`: 通过：Windows、macOS、Linux 构建和 Publish GitHub Release 全部 success。

- 2026-07-16T07:51:14.276Z `版本一致性检查`: 通过：package、package-lock、Tauri、Cargo.toml 和 CodeM Cargo.lock 均为 0.1.11。
- 2026-07-16T07:51:13.480Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。

- 2026-07-16T07:51:12.636Z `npm run package:doctor`: 通过：Doctor: OK。
- 2026-07-16T07:51:11.834Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 136 项、桌面 main 9 项测试通过，0 失败；1 项需真实 Grok 登录的 smoke test 按设计忽略。

- 2026-07-16T07:51:10.992Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。
- 2026-07-16T07:51:10.173Z `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过：10 项发布工作流、资产收集与 latest.json 测试全部通过。

## Completion Summary
- 2026-07-16T08:07:45.445Z v0.1.11 已基于 GitHub main@1e2123e 成功发布；Windows、macOS、Linux 构建及 Release 发布全部通过，19 个安装、签名、源码、latest.json 和校验资产齐全，自动更新元数据已指向新版本；Gitee 未推送。

## Follow-ups

- 后续升级 GitHub Actions action 主版本，消除 Node.js 20 运行时弃用提示。
