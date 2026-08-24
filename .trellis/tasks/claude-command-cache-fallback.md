# Task: Claude 命令解析纳入缓存与瞬时失败兜底

## Background

待补充背景。

## Objective

修复 /api/claude/run 每次发送无缓存探测 claude 命令、瞬时超时即报未找到 claude 命令的问题：纳入 resolve_agent_command 缓存体系（TTL 缓存 + 过期命令兜底），与 7615c09 对 opencode 的修法对齐

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
- 2026-08-24T08:10:58.166Z 已修复 Claude 命令解析无缓存问题：resolve_agent_command 增加 CLAUDE_CODE_PROVIDER_ID 分支与 CommandResolvers.claude，AgentRunService::new 增加 claude resolver 参数；/api/claude/run 改走 state.agent_runs.resolve_command（TTL 缓存 + 过期命令兜底 + 负缓存），与 7615c09 对 opencode 的修法对齐。lifecycle 更新成功后的 resolve_command(provider_id, true) 现在也能正确失效 claude 缓存。新增回归测试 expired_claude_command_survives_a_transient_resolution_failure。根因：5afc145（7/17）起每个候选必须实际跑 claude --version 验证，Windows 下 .cmd→cmd→node 冷启动偶发超时即整体失败；claude 未纳入 7615c09（8/18）的缓存兜底体系。

- 2026-08-24T08:01:59.804Z Task created by Trellis automation.

## Verification Results
- 2026-08-24T08:10:58.699Z `cargo check --manifest-path src-tauri/Cargo.toml; cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests; cargo test --manifest-path src-tauri/Cargo.toml backend::tests`: 通过：cargo check 干净（仅 2 个既有无关 warning）；agent_run::tests 115 通过（含新增 claude 兜底用例）；backend::tests 173 通过；cargo fmt 后仅 main.rs 既有漂移，本次改动文件格式干净

## Completion Summary
- 2026-08-24T08:10:59.210Z Claude 命令解析已纳入统一缓存体系：发送消息复用 5 分钟 TTL 缓存，探测瞬时失败沿用上次成功命令，负缓存 60 秒防重复探测；桌面开发壳已重启验证（codem.exe PID 35224）。注意：应用启动后首次解析仍走完整探测，冷启动超时仍可能失败一次，属既有边界。

## Follow-ups

- 待补充。
