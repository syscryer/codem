# Task: 修复 Hermes Agent 设置诊断失败

## Background

待补充背景。

## Objective

补齐 Hermes 生命周期计划，使 Agent 设置诊断接口返回正常

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- 2026-08-10T17:39:52.958Z Hermes 最新版本查询改为复用 GitHub Releases 探针，官方仓库固定为 NousResearch/hermes-agent；查询保持直连后按配置代理重试，更新命令仍使用官方 hermes update，不改变其他 Agent 的 npm/Grok/OpenCode 分支。
- 2026-08-10T02:53:18.482Z 定位并修复 Hermes 设置诊断 500：后端诊断接口会为所有 Provider 构建安装/更新生命周期计划，Hermes 缺少官方计划导致 400/500；已补齐 Windows/Linux/macOS 官方安装器、hermes update，以及未安装时的更新计划分支。

- 2026-08-10T02:34:12.670Z Task created by Trellis automation.

## Verification Results

- 2026-08-10T17:40:27.322Z `cargo fmt --check; Hermes lifecycle test; npm version parser regression; cargo test; codem-agent-onboarding check_onboarding.py; npm run typecheck; runtime and automation tests; npm run build; git diff --check`: 格式通过；定向测试 1/1 与 1/1；Rust 475 passed, 1 ignored；onboarding 72/72，typecheck、runtime、automation、build 与 diff 检查全部通过。
- 2026-08-10T17:40:18.071Z `GET runtime identity and Hermes latest-version providerId=hermes-agent currentVersion=0.20.0`: 身份返回 app=codem, backend=rust；Hermes 返回 latestVersion=2026.8.3、updateAvailable=true、error=null。

- 2026-08-10T02:53:48.458Z `npm run typecheck`: 通过
- 2026-08-10T02:53:48.012Z `cargo check --manifest-path src-tauri/Cargo.toml`: 通过，0 errors，保留仓库既有 warnings

- 2026-08-10T02:53:19.867Z `git diff --check`: 通过
- 2026-08-10T02:53:19.505Z `独立备用端口 3311 GET /api/agents/settings-diagnostics?providerId=hermes-agent`: HTTP 200，返回官方安装命令和诊断结构

- 2026-08-10T02:53:19.160Z `cargo test --manifest-path src-tauri/Cargo.toml hermes_lifecycle_plans_match_the_official_installer_and_update_command --lib`: 通过，1/1，覆盖已安装和未安装分支
- 2026-08-10T02:53:18.824Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过

## Completion Summary

- 2026-08-10T17:40:48.401Z Hermes 设置页已接入官方 GitHub Releases 最新版本查询，复用统一代理机制并保持其他 Agent 查询路径不变；自动化门禁与重启后的真实 Agent Mux 接口均通过，当前显示版本应为 2026.8.3。
- 2026-08-10T02:53:48.842Z Hermes Agent 设置诊断失败已修复：补齐官方安装/更新生命周期计划，覆盖已安装和未安装分支；诊断接口独立实测 HTTP 200，Rust 测试、格式、cargo check、TypeScript 和差异检查通过。

## Follow-ups

- 待补充。
