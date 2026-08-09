# Task: 发布 CodeM v0.1.23

## Background

计划进度、会话上下文与工作台交互改进已合入 main，需要发布稳定版本。

## Objective

发布 v0.1.23。

## Scope

In scope:

- 更新版本元数据与 README。
- 执行前端、Rust、打包及发布流程验证。
- 推送 main 与 v0.1.23 标签到 Gitee、GitHub，并核验 GitHub Release 产物。

Out of scope:

- 不追加本次发布范围外的功能改动。

## Impact

- 用户可获得统一的 Agent 计划与会话上下文展示，以及恢复后的工作台响应式交互。

## Acceptance Criteria

- [x] 版本号统一为 0.1.23，发布门禁全部通过。
- [ ] main 与 v0.1.23 标签同步到 Gitee、GitHub。
- [ ] GitHub Release 包含三平台安装包、签名、latest.json 和 SHA256SUMS.txt。

## Verification Commands

- `npm test`
- `npm run build`
- `cargo fmt --check`
- `cargo test`
- `npm run package:doctor`
- `node --test scripts/release-workflow.test.mjs`
- `git diff --check`

## Implementation Record

- 2026-08-09T07:10:04.049Z 发布任务创建，版本元数据更新为 0.1.23。
- 2026-08-09T07:16:39.198Z 修正 3 条重构后过时断言，发布门禁全部通过。

## Verification Results

- 2026-08-09T07:16:39.198Z 前端全量测试：864 passed，0 failed。
- 2026-08-09T07:16:39.198Z Rust：450 passed，1 ignored；cargo fmt --check 通过。
- 2026-08-09T07:16:39.198Z npm run build、package:doctor、12 条发布脚本测试与 git diff --check 通过。

## Completion Summary

## Follow-ups

- 待发布完成后补充。
