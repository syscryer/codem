# Task: 发布 0.1.8 版本

## Background

CodeM 上一个已提交版本号为 0.1.7，本次按用户要求准备发布 0.1.8。

## Objective

同步版本号并创建 v0.1.8 发布标签

## Scope

In scope:

- 将 npm、Tauri 和 Rust 包版本同步到 0.1.8。
- 校验发布 workflow 所需的 tag/version 一致性。
- 创建并仅向 GitHub origin 推送 v0.1.8 发布标签。

Out of scope:

- 不修改业务功能。
- 不在本地执行完整跨平台打包，正式构建交给 GitHub Release workflow。

## Impact

- 影响发布元数据、锁文件和发布自动化触发标签。
- Gitee 仅同步 main 分支代码，不推送发布标签。

## Acceptance Criteria

- [x] package.json 版本为 0.1.8。
- [x] src-tauri/tauri.conf.json 版本为 0.1.8。
- [x] Cargo.toml、Cargo.lock、package-lock.json 版本保持一致。
- [x] 本地校验通过，版本提交可用于创建 v0.1.8 标签。
- [x] v0.1.8 发布标签仅推送 GitHub origin。

## Verification Commands

- npm run package:doctor
- npm run typecheck
- git diff --check
- 版本一致性检查

## Implementation Record

- 2026-06-24T01:56:44.137Z 用户确认 Gitee 不发布；本次 v0.1.8 发布标签仅推送 GitHub origin，Gitee 只同步 main 分支代码。
- 2026-06-24T01:46:11.987Z 同步 package.json、package-lock.json、src-tauri/tauri.conf.json、Cargo.toml、Cargo.lock 版本到 0.1.8，并补充发布任务边界与验收标准。

- 2026-06-24T01:45:00.227Z Task created by Trellis automation.

## Verification Results
- 2026-06-24T01:50:53.196Z `变更内容敏感信息扫描`: 通过：针对实际变更内容扫描未发现密钥、密码或私钥模式。

- 2026-06-24T01:50:39.531Z `git diff --check`: 通过：退出码 0，仅输出 Windows 行尾提示。
- 2026-06-24T01:50:26.258Z `npm run typecheck`: 通过：tsc -b 退出码 0。

- 2026-06-24T01:50:13.505Z `npm run package:doctor`: 通过：Doctor: OK。
- 2026-06-24T01:49:54.863Z `版本一致性检查`: 通过：package.json、package-lock.json、src-tauri/tauri.conf.json、Cargo.toml、Cargo.lock 均为 0.1.8。

## Completion Summary
- 2026-06-24T01:57:06.283Z 完成 0.1.8 发布准备：版本号已同步，本地发布前校验通过；v0.1.8 发布标签仅推送 GitHub origin，Gitee 不推送发布标签。

## Follow-ups

- 暂无。
