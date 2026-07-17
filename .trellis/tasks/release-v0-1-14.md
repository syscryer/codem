# Task: 发布 v0.1.14

## Background

`v0.1.13` 发布后，主线完成了运行清理与回合结果丢失修复，并完善 macOS Claude 原生安装、系统代理继承、窗口材质幂等和 WebKit 合成层资源释放。本次将这些已完成的修复发布为新的补丁版本。

## Objective

从 GitHub 最新 main 基线同步 Gitee，发布 CodeM v0.1.14，并完成版本、质量门禁、双远端与 GitHub Release 产物核验

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本统一升级到 `0.1.14`。
- 纳入 `v0.1.13` 之后的运行持久化、macOS 安装与桌面渲染修复。
- 将 GitHub 已有的最新主线同步到 Gitee，并确保版本提交依次推送 Gitee `main` 和 GitHub `main`。
- 基于 GitHub `main` 创建并推送 `v0.1.14` 标签，由 Release workflow 生成各平台安装包、签名、`latest.json` 和校验文件。
- 核对 GitHub Release、自动更新元数据和所有构建任务的最终状态。

Out of scope:

- 不提交本机未跟踪的 `CONTEXT.md`。
- 不调整发布矩阵、自动更新签名密钥和安装包结构。
- 不改写已有历史标签。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布记录：`.trellis/tasks/` 与 `.trellis/workspace/sessions/`。
- 远端：Gitee/GitHub `main`、GitHub `v0.1.14` 标签和 Release 资产。

## Acceptance Criteria

- [x] 所有 CodeM 版本元数据一致为 `0.1.14`。
- [x] 发布脚本测试、前端全量测试、类型检查、Rust 全量测试、package doctor、cargo fmt 和 diff check 通过。
- [x] 版本提交依次推送到 Gitee 和 GitHub，`v0.1.14` 标签仅推送到 GitHub。
- [x] GitHub Release workflow 全部成功并生成各平台安装包、签名、`latest.json` 和 `SHA256SUMS.txt`。

## Verification Commands

- `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`
- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run package:doctor`
- `git diff --check`
- 版本一致性检查

## Implementation Record
- 2026-07-17T14:59:33.448Z GitHub Actions 继续报告 actions/*@v4 与 softprops/action-gh-release@v2 的 Node.js 20 弃用提示，runner 已强制使用 Node.js 24，本次构建与发布不受影响；按任务边界留待后续升级 action 主版本。

- 2026-07-17T14:42:55.878Z GitHub/Gitee main 已统一到 1cf5483，发布范围覆盖运行清理与结果持久化、macOS Claude 原生安装及代理适配、窗口材质幂等和 WebKit 合成资源释放；五处版本元数据已升级到 0.1.14，CONTEXT.md 保持未跟踪。
- 2026-07-17T14:41:38.082Z 发布前确认 GitHub main 与本地为 844ea7b，Gitee main 落后一笔 macOS 修复提交；工作区仅有 backend.rs 一行 Windows 代理环境变量大小写兼容测试修正，定向 Rust 测试与 cargo fmt --check 已通过，将先独立提交后再发布 v0.1.14。

- 2026-07-17T14:41:02.897Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T14:59:37.531Z `remote refs`: 通过：Gitee main、GitHub main 和 GitHub v0.1.14 均指向发布提交 8891424。
- 2026-07-17T14:59:36.535Z `GitHub latest.json`: 通过：version=0.1.14，windows-x86_64、darwin-aarch64、linux-x86_64 均指向 v0.1.14 签名资产。

- 2026-07-17T14:59:35.488Z `GitHub Release v0.1.14 assets`: 通过：正式版非草稿、非预发布，包含 19 个资产，Windows EXE/MSI/portable、macOS DMG/app、Linux AppImage/deb/rpm、updater 签名、源码包、latest.json 和 SHA256SUMS.txt 齐全。
- 2026-07-17T14:59:34.473Z `GitHub Actions run 29589343580`: 通过：macOS arm64 7 分 27 秒、Linux x64 9 分 43 秒、Windows x64 12 分 3 秒及 Publish GitHub Release 全部 success。

- 2026-07-17T14:44:59.354Z `版本一致性检查`: 通过：package、package-lock、Tauri、Cargo.toml 和 CodeM Cargo.lock 均为 0.1.14。
- 2026-07-17T14:44:58.339Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。

- 2026-07-17T14:44:57.224Z `npm run package:doctor`: 通过：Doctor: OK。
- 2026-07-17T14:44:56.241Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：Rust 格式检查无差异。

- 2026-07-17T14:44:55.228Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 154 项、桌面 main 11 项测试通过，0 失败；1 项需真实 Grok 登录的 smoke test 按设计忽略。
- 2026-07-17T14:44:54.234Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。

- 2026-07-17T14:44:53.203Z `node --import tsx --test src/**/*.test.ts`: 通过：前端 535 项测试全部通过，0 失败。
- 2026-07-17T14:44:52.174Z `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过：10 项发布工作流、资产收集与 latest.json 测试全部通过。

## Completion Summary
- 2026-07-17T14:59:54.339Z 已完成 CodeM v0.1.14 发布；发布前同步 GitHub/Gitee 主线并提交代理环境变量测试兼容修正，发布提交 8891424 已同步两端，Windows、macOS、Linux 构建及 Release 全部通过，19 个安装、签名、源码、latest.json 和校验资产齐全。

## Follow-ups

- GitHub Actions action 主版本升级另行处理，不纳入本次发布。
