# Task: 发布 CodeM v0.1.24

## Background

Agent Workflow 编排能力已合入 main，需要发布稳定版本。

## Objective

发布 v0.1.24。

## Scope

In scope:

- 更新版本元数据与 README。
- 执行前端、Rust、打包及发布流程验证。
- 推送 main 与 v0.1.24 标签到 Gitee、GitHub，并核验 GitHub Release 产物。

Out of scope:

- 不追加本次发布范围外的功能改动。

## Impact

- 用户可创建、编辑、保存、运行、停用和发布 Agent Workflow，并从聊天进入工作流。

## Acceptance Criteria

- [ ] 版本号统一为 0.1.24，发布门禁全部通过。
- [ ] main 与 v0.1.24 标签同步到 Gitee、GitHub。
- [ ] GitHub Release 包含三平台安装包、签名、latest.json 和 SHA256SUMS.txt。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test "src/**/*.test.ts" "tests/**/*.test.ts"`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs scripts/release-assets.test.mjs scripts/doctor.test.mjs`
- `git diff --check`

## Implementation Record

- 2026-08-13T06:09:28.633Z 发布任务创建，版本元数据更新为 0.1.24。

## Verification Results

- 2026-08-13T06:09:28.633Z npm run typecheck、npm run build、cargo fmt --check、npm run package:doctor 与 git diff --check 通过。
- 2026-08-13T06:09:28.633Z 前端全量测试：898 passed，0 failed。
- 2026-08-13T06:09:28.633Z Rust：517 passed，1 ignored；12 条发布脚本测试全部通过。

## Completion Summary

## Follow-ups

- 待发布完成后补充。
