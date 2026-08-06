# Task: 发布 v0.1.21

## Background

`v0.1.20` 之后已完成 Agent Mux 的真实配置、独立 Runtime、CLI/Skill 调用、运行监控、取消与刷新恢复闭环，
并接入当前会话的上下文摘要、DeepSeek Responses 渠道及统一下拉等体验改进。本次将这些已提交能力发布为 `v0.1.21`。

## Objective

发布 Agent Hub、Agent Mux 会话闭环与会话上下文增强，更新版本和 README，并完成双远端与 GitHub Release 验收

## Scope

In scope:

- 将 npm、Cargo 与 Tauri 版本统一升级到 `0.1.21`。
- README 补充 Agent Mux、DeepSeek Responses 和会话上下文摘要能力。
- 验证全量前端测试、生产构建、Rust 格式与全量测试、打包环境和发布 workflow。
- 先推送 Gitee `origin/main`，再推送 GitHub `github/main`；随后按相同顺序推送 `v0.1.21` tag。
- 等待 GitHub Release workflow 完成并验收多平台安装包、签名、`latest.json`、校验文件和源码包。

Out of scope:

- 不调整发布矩阵、安装包格式或自动更新签名密钥。
- 不修改或提交用户现有的 `.trellis/tasks/conversation-context-runtime.md` 工作区变更。
- 不在发布任务中扩展 Agent Hub、Agent Mux 或会话上下文的产品边界。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 用户文档：`README.md`。
- 发布记录：本任务和对应 Trellis session record。

## Acceptance Criteria

- [x] 所有发布元数据一致为 `0.1.21`。
- [x] README 准确描述本次主要用户能力。
- [x] 全量前端测试、生产构建、Rust 格式检查与全量测试通过。
- [x] `package:doctor`、发布 workflow 回归测试和空白检查通过。
- [ ] Gitee 与 GitHub `main`、`v0.1.21` tag 同步一致。
- [ ] GitHub Release workflow 完成，并生成各平台安装包、签名、`latest.json`、校验文件和源码包。

## Verification Commands

- `$testFiles = @(rg --files src | Where-Object { $_ -match '\.test\.tsx?$' }); node --import tsx --test $testFiles`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs`
- `git diff --check`

## Implementation Record

- 2026-08-06T15:09:37.107Z 发布门禁发现 3 个前端结构测试仍绑定重构前源码位置；已更新测试以校验共享 MarkdownContent 的 deferred/memo/code renderer，以及默认 Agent 仅更新未手动选择的草稿 Provider，生产逻辑未改。
- 2026-08-06T15:06:54.763Z 已基于 main@c787b27 准备 v0.1.21：统一 npm/Cargo/Tauri 版本，README 补充 Agent Mux、DeepSeek Responses 和会话上下文摘要；明确排除用户现有 conversation-context-runtime.md 修改。

- 2026-08-06T15:05:08.657Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T15:14:03.978Z `发布打包与 workflow 回归`: 通过：package:doctor、release-workflow.test.mjs、git diff --check 均成功
- 2026-08-06T15:14:03.061Z `生产构建与 Rust 格式`: 通过：npm run build 与 cargo fmt --check 均成功，仅有既有 Vite chunk 和 Rust dead_code 警告

- 2026-08-06T15:14:02.096Z `Rust 全量测试`: 通过：library 441 passed、1 ignored；codem-agent-mux 13 passed；其他二进制 10 passed
- 2026-08-06T15:14:01.214Z `前端全量测试`: 通过：772 passed，0 failed；并修正 4 条重构后过时的结构断言

## Completion Summary

## Follow-ups

- 无。
