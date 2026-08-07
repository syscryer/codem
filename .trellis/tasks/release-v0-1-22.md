# Task: 发布 CodeM v0.1.22

## Background

在 Agent Provider 标准化、模型目录与渠道选择体验完成后发布稳定版本。

## Objective

发布 v0.1.22，包含 Agent Provider 标准化与渠道会话体验改进。

## Scope

In scope:

- 更新版本元数据、README 和发布说明。
- 执行前端、Rust、打包及发布流程验证。
- 推送 main 与 v0.1.22 标签到 Gitee、GitHub，并核验 GitHub Release 产物。

Out of scope:

- 不追加本次发布范围外的功能改动。

## Impact

- 用户可通过 Provider 渠道选择使用检测到的 Agent、模型目录与渠道会话能力。

## Acceptance Criteria

- [x] 版本号统一为 0.1.22，发布门禁全部通过。
- [x] main 与 v0.1.22 标签同步到 Gitee、GitHub。
- [x] GitHub Release 包含 Windows、macOS、Linux 安装包、签名、latest.json 和 SHA256SUMS.txt。

## Verification Commands

- `npm test`
- `npm run build`
- `cargo fmt --check`
- `cargo test`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs`
- `git diff --check`

## Implementation Record
- 2026-08-07T17:59:15.316Z 发布门禁完成：前端全量 780 passed、npm run build、cargo fmt --check、cargo test（472 passed，1 ignored）、package:doctor、release-workflow.test.mjs、git diff --check 均通过。发布元数据已更新为 0.1.22，README 补充 Provider 渠道选择说明，两个重构后过时结构断言已改为共享元数据断言。

- 2026-08-07T17:42:11.065Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T18:00:17.224Z `Rust 与发布门禁`: pass: cargo 472 passed/1 ignored; build; fmt; doctor; release-workflow; diff-check
- 2026-08-07T17:59:41.100Z `前端全量测试`: pass: 780 passed, 0 failed

## Completion Summary

- v0.1.22 已发布：https://github.com/syscryer/codem/releases/tag/v0.1.22
- 双远端 main 均指向 943ec8a151487973b9014010a1efb66df1ffedc5，标签已同步。
- Release 共包含 19 个产物，关键安装包、latest.json 与 SHA256SUMS.txt 下载验证正常。

## Follow-ups

- 无。
