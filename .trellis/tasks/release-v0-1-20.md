# Task: 发布 v0.1.20

## Background

`v0.1.19` 之后已完成 Codex 原生会话压缩、Codex 与 Claude“在新聊天继续”、链接打开与本地网页预览，
并将 Grok、OpenCode、Pi 的文件产出统一接入现有文件卡片、修改摘要和 Diff 闭环；同时修复 Claude 渠道设置持久化和 macOS 私有 API 配置。

## Objective

发布 Codex 原生压缩、Codex/Claude 新聊天续接、文件与网页预览及渠道设置修复，更新 README 和版本元数据并触发多平台构建

## Scope

In scope:

- 将 npm、Cargo 与 Tauri 版本统一升级到 `0.1.20`。
- README 增加 Codex 压缩、新聊天续接、链接预览和多 Provider 文件变更能力说明。
- 验证全量前端测试与生产构建、Rust 全量测试、格式检查和打包环境。
- 先同步 Gitee `main`，再同步 GitHub `main`，最后推送 `v0.1.20` tag 触发 GitHub Release workflow。

Out of scope:

- 不修改自动更新签名密钥、发布矩阵或安装包格式。
- 不提交 `.claude/settings.local.json`、`.mcp.json` 和未引用的临时图片。
- 不在发布任务中扩展 Codex/Claude fork、compact 或 Provider 文件变更的既定产品边界。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 用户文档：`README.md`。
- 发布记录：本任务和对应 Trellis session record。

## Acceptance Criteria

- [x] 所有发布元数据一致为 `0.1.20`。
- [x] README 准确列出本次主要用户能力。
- [x] 全量前端测试、生产构建、Rust 格式检查与全量测试通过。
- [x] `package:doctor`、发布 workflow 回归测试和空白检查通过。
- [ ] GitHub Release workflow 完成，并生成各平台安装包、签名、`latest.json` 和校验文件。

## Verification Commands

- `$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' }); node --import tsx --test $testFiles`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs`
- `git diff --check`

## Implementation Record

- 2026-08-03T13:54:17.590Z 已修复 Claude delayed Fork 终态竞态：协议错误事件与 finished 状态在同一锁内原子提交，再关闭运行时；原失败用例连续 10 次及 delayed Fork 11 项测试全部通过。
- 2026-08-03T13:46:16.993Z 发布阻断确认：前端全量 727 passed；Claude delayed fork 无 init 用例单独复跑通过，但 init_binds_before_exit 单线程稳定失败（期望固定快照与子 transcript 共 2 份，实际 1 份）。将先修复真实持久化流程并验证，再继续发版。

- 2026-08-03T13:45:45.002Z 发布门禁首轮：快进后 node_modules 缺少 tsx，已通过 npm ci 恢复；Rust 全量 410 passed、2 failed、1 ignored，失败集中于两个 Claude delayed fork 真实子进程测试，正在单线程精确复现，未进入提交或 tag。
- 2026-08-03T13:42:00.102Z 已基于 GitHub/Gitee main@3ac0154 准备 v0.1.20：统一 npm/Cargo/Tauri 版本，README 补充 Codex 压缩、新聊天续接、链接预览和多 Provider 文件 Diff；排除本机配置与临时图片。

- 2026-08-03T13:40:19.466Z Task created by Trellis automation.

## Verification Results

- 2026-08-03T13:55:48.261Z `发布打包与 workflow 回归`: 通过：package:doctor、release-workflow.test.mjs、git diff --check 均成功
- 2026-08-03T13:55:47.581Z `生产构建与 Rust 格式`: 通过：npm run build 与 cargo fmt --check 均成功，仅有既有 Vite chunk 警告

- 2026-08-03T13:55:46.915Z `Rust 全量测试`: 通过：412 passed，0 failed，1 ignored（需真实 Grok CLI 登录）
- 2026-08-03T13:55:46.288Z `前端全量测试`: 通过：727 passed，0 failed

## Completion Summary

## Follow-ups

- 无。
