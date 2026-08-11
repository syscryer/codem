# Session Record: Hermes Settings Diagnostics

- Session: session-20260810-163151-awgb
- Started: 2026-08-10T16:31:51.979Z
- Task: .trellis/tasks/hermes-settings-diagnostics.md

## Notes
- 2026-08-10T17:39:52.958Z Hermes 最新版本查询改为复用 GitHub Releases 探针，官方仓库固定为 NousResearch/hermes-agent；查询保持直连后按配置代理重试，更新命令仍使用官方 hermes update，不改变其他 Agent 的 npm/Grok/OpenCode 分支。

- 2026-08-10T16:31:51.980Z Session started.

## Verification

- 2026-08-10T17:40:27.322Z `cargo fmt --check; Hermes lifecycle test; npm version parser regression; cargo test; codem-agent-onboarding check_onboarding.py; npm run typecheck; runtime and automation tests; npm run build; git diff --check`: 格式通过；定向测试 1/1 与 1/1；Rust 475 passed, 1 ignored；onboarding 72/72，typecheck、runtime、automation、build 与 diff 检查全部通过。
- 2026-08-10T17:40:18.071Z `GET runtime identity and Hermes latest-version providerId=hermes-agent currentVersion=0.20.0`: 身份返回 app=codem, backend=rust；Hermes 返回 latestVersion=2026.8.3、updateAvailable=true、error=null。

## Completed

- 2026-08-10T17:40:48.401Z Hermes 设置页已接入官方 GitHub Releases 最新版本查询，复用统一代理机制并保持其他 Agent 查询路径不变；自动化门禁与重启后的真实 Agent Mux 接口均通过，当前显示版本应为 2026.8.3。
