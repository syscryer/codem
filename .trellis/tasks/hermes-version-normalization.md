# Task: 修复 Hermes 最新版本号误判

## Background

Hermes GitHub Release 使用日期型 `tag_name`（例如 `v2026.8.3`），而 CLI `hermes --version` 返回产品语义版本（例如 `0.20.0`）。当前 CodeM 直接比较两者，导致已是最新版仍显示可更新。

## Objective

从 Hermes Release 名称读取产品版本，避免日期型 tag 触发错误更新提示

## Scope

In scope:

- 从 Hermes GitHub Release `name` 中提取产品语义版本。
- 保留其他 Agent 现有 npm、Grok 和 GitHub tag 版本查询逻辑。
- 增加 Rust 回归测试并通过真实后端接口验证。

Out of scope:

- 不修改 Hermes 安装、更新命令或认证配置。
- 不改动前端版本展示合同。
- 不将日期型 Release tag 当作可比较的产品版本。

## Impact

- Backend Hermes 最新版本查询与语义版本比较。
- Agent 设置页消费现有 `latestVersion` / `updateAvailable` 字段，无新增前端分支。

## Acceptance Criteria

- [ ] `Hermes Agent v0.20.0 (2026.8.3)` 解析为 `0.20.0`。
- [ ] 当前版本和最新版本均为 `0.20.0` 时，`updateAvailable=false`。
- [ ] 其他 GitHub Release 查询仍从 `tag_name` 解析版本。
- [ ] Hermes 相关 Rust 测试、TypeScript 检查、前端构建和差异检查通过。
- [ ] 重启桌面开发端后，真实接口返回 `latestVersion=0.20.0` 且 `updateAvailable=false`。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml hermes_github_release_version_parser --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml github_release_tag_version_parser --lib`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 重启后请求 `/api/agents/latest-version?providerId=hermes-agent&currentVersion=0.20.0`

## Implementation Record
- 2026-08-11T03:54:42.311Z 重启桌面开发壳后，通过动态 Agent Mux runtime 文件读取端口和令牌，真实调用 Hermes latest-version 接口；返回 latestVersion=0.20.0、updateAvailable=false、error=null，runtime identity 为 app=codem/backend=rust。

- 2026-08-11T03:51:02.433Z 将 Hermes GitHub Release 版本查询改为从 Release name 提取产品语义版本；通用 GitHub tag 解析保持不变，并新增两组回归测试。
- 2026-08-11T03:50:46.377Z 将 Hermes GitHub Release 版本查询改为从 Release name 提取产品语义版本；通用 GitHub tag 解析保持不变，并新增两组回归测试。

- 2026-08-11T03:46:41.301Z Task created by Trellis automation.

## Verification Results

- 2026-08-11T03:51:02.473Z `cargo fmt; cargo test --manifest-path src-tauri/Cargo.toml github_release_tag_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml hermes_github_release_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml --lib; npm run typecheck; npm run build; python onboarding check; git diff --check`: 全部通过；Rust 全量测试 478 项中 477 通过、1 ignored；保留既有编译 warnings。
- 2026-08-11T03:50:46.376Z `cargo fmt; cargo test --manifest-path src-tauri/Cargo.toml github_release_tag_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml hermes_github_release_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml --lib; npm run typecheck; npm run build; python C:\Users\syscr\.codex\skills\codem-agent-onboarding\scripts\check_onboarding.py D:\ai_proj\codem; git diff --check`: 全部通过；Rust 全量测试 478 项中 477 通过、1 ignored；保留既有编译 warnings。

## Completion Summary
- 2026-08-11T03:55:00.310Z Hermes 版本查询已按产品语义版本归一化：Release name 提取 0.20.0，日期型 tag 不再参与比较；回归测试、Rust/TypeScript/构建/onboarding/diff 门禁及重启后真实接口验收全部通过。

## Follow-ups

- 无。
