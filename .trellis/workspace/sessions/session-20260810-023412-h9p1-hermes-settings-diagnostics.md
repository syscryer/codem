# Session Record: 修复 Hermes Agent 设置诊断失败

- Session: session-20260810-023412-h9p1
- Started: 2026-08-10T02:34:12.669Z
- Task: .trellis/tasks/hermes-settings-diagnostics.md

## Notes
- 2026-08-10T02:53:18.482Z 定位并修复 Hermes 设置诊断 500：后端诊断接口会为所有 Provider 构建安装/更新生命周期计划，Hermes 缺少官方计划导致 400/500；已补齐 Windows/Linux/macOS 官方安装器、hermes update，以及未安装时的更新计划分支。

- 2026-08-10T02:34:12.673Z Session started.

## Verification

- 2026-08-10T02:53:48.458Z `npm run typecheck`: 通过
- 2026-08-10T02:53:48.012Z `cargo check --manifest-path src-tauri/Cargo.toml`: 通过，0 errors，保留仓库既有 warnings

- 2026-08-10T02:53:19.867Z `git diff --check`: 通过
- 2026-08-10T02:53:19.505Z `独立备用端口 3311 GET /api/agents/settings-diagnostics?providerId=hermes-agent`: HTTP 200，返回官方安装命令和诊断结构

- 2026-08-10T02:53:19.160Z `cargo test --manifest-path src-tauri/Cargo.toml hermes_lifecycle_plans_match_the_official_installer_and_update_command --lib`: 通过，1/1，覆盖已安装和未安装分支
- 2026-08-10T02:53:18.824Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 通过

## Completed

- 2026-08-10T02:53:48.842Z Hermes Agent 设置诊断失败已修复：补齐官方安装/更新生命周期计划，覆盖已安装和未安装分支；诊断接口独立实测 HTTP 200，Rust 测试、格式、cargo check、TypeScript 和差异检查通过。
