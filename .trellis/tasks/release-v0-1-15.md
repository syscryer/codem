# Task: 发布 v0.1.15

## Background

`v0.1.14` 发布后，主线补齐了深色主题下聊天、设置和工作台区域的视觉适配，限制深色模式使用不合适的透明窗口材质，并增加应用更新提醒。本次将这些已完成的体验改进发布为新版本。

## Objective

从双远端一致的 main 基线发布 CodeM v0.1.15，完成版本同步、质量门禁、双远端推送与 GitHub Release 产物核验

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本统一升级到 `0.1.15`。
- 纳入 `v0.1.14` 之后的深色主题一致性、窗口材质限制和应用更新提醒。
- 版本提交按项目约定先推送 Gitee `main`，再推送 GitHub `main`。
- 基于 GitHub `main` 创建并推送 `v0.1.15` 标签，由 Release workflow 生成各平台安装包、签名、`latest.json` 和校验文件。
- 核对 GitHub Release、自动更新元数据和所有构建任务的最终状态。

Out of scope:

- 不提交本机未跟踪的 `CONTEXT.md`。
- 不调整发布矩阵、自动更新签名密钥和安装包结构。
- 不改写已有历史标签。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布记录：`.trellis/tasks/` 与 `.trellis/workspace/sessions/`。
- 远端：Gitee/GitHub `main`、GitHub `v0.1.15` 标签和 Release 资产。

## Acceptance Criteria

- [ ] 所有 CodeM 版本元数据一致为 `0.1.15`。
- [ ] 发布脚本测试、前端全量测试、类型检查、Rust 全量测试、package doctor、cargo fmt 和 diff check 通过。
- [ ] 版本提交依次推送到 Gitee 和 GitHub，`v0.1.15` 标签仅推送到 GitHub。
- [ ] GitHub Release workflow 全部成功并生成各平台安装包、签名、`latest.json` 和 `SHA256SUMS.txt`。

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
- 2026-07-17T17:28:47.965Z 已确认本地、Gitee origin/main 与 GitHub github/main 均指向 10345ff，最新正式版为 v0.1.14；本次发布范围为深色主题一致性、深色窗口材质限制和应用更新提醒，五处版本元数据已升级到 0.1.15，CONTEXT.md 保持未跟踪。

- 2026-07-17T17:27:32.743Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T17:33:22.887Z `版本一致性检查`: 通过，五处版本元数据均为 0.1.15
- 2026-07-17T17:33:22.824Z `git diff --check`: 通过，仅有 Git 行尾转换提示

- 2026-07-17T17:33:22.757Z `npm run package:doctor`: 通过，Doctor: OK
- 2026-07-17T17:33:22.702Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

- 2026-07-17T17:33:22.646Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过，lib 154 项通过、1 项 Grok smoke 按设计忽略；desktop main 11/11
- 2026-07-17T17:33:22.574Z `npm run typecheck`: 通过

- 2026-07-17T17:33:22.499Z `node --import tsx --test src/**/*.test.ts`: 通过，548/548
- 2026-07-17T17:33:22.429Z `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过，10/10

## Completion Summary

## Follow-ups

- GitHub Actions action 主版本升级另行处理，不纳入本次发布。
