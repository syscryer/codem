# Task: 修复 Hermes CLI 发现

## Background

待补充背景。

## Objective

让 CodeM 识别实际安装的 Hermes CLI，并恢复 Hermes Provider 的可用性

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
- 2026-08-10T04:35:46.009Z 定位到 Hermes CLI 位于 %TEMP%\\codem-hermes-venv\\Scripts\\hermes.exe；现有解析仅查 PATH、~/.local/bin 与 Python Scripts，决定补充 CodeM 隔离环境候选并通过版本探测确认可用

- 2026-08-10T04:32:13.890Z Task created by Trellis automation.

## Verification Results
- 2026-08-10T04:45:10.245Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test --manifest-path src-tauri/Cargo.toml hermes --lib; npm run typecheck; npm run build; python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem; GET /api/agents/providers; GET /api/agents/hermes/bootstrap`: 全部通过；Hermes 13/13，onboarding 72/72，Provider available/selectable=true，Bootstrap commandAvailable=true 且 serve 已就绪

## Completion Summary
- 2026-08-10T04:45:45.482Z 修复 Hermes CLI 发现：后端新增 CodeM 隔离虚拟环境候选 %TEMP%\\codem-hermes-venv\\Scripts\\hermes.exe，并通过 hermes --version 真实校验；重启后 Provider 与 Hermes serve 均已恢复可用。

## Follow-ups

- 待补充。
