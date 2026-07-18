# Session Record: 补充 Grok ACP 上游错误

- Session: session-20260718-112246-tewk
- Started: 2026-07-18T11:22:46.689Z
- Task: .trellis/tasks/grok-acp-error-enrichment.md

## Notes

- 2026-07-18T11:33:15.523Z 真实 Grok 请求已验证前端错误事件可直接收到上游 401 Unauthorized；泛化 RPC -32603 的当前渠道日志反查路径由 4 个定向测试覆盖。
- 2026-07-18T11:27:51.931Z 已实现 Grok ACP 泛化错误增强：仅从当前 CodeM 渠道 GROK_HOME 的日志尾部按 sessionId 和本轮时间匹配真实上游错误，并在进入 error event 前脱敏。

- 2026-07-18T11:22:46.700Z Session started.

## Verification
- 2026-07-18T11:33:13.688Z `git diff --check`: pass: only existing CRLF conversion warnings

- 2026-07-18T11:33:11.608Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`: pass
- 2026-07-18T11:33:10.505Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: pass: 28 passed, 0 failed

## Completed

- 2026-07-18T11:33:16.956Z Grok ACP 泛化 Internal error 现在会从当前 CodeM 渠道隔离日志中按 session 和本轮时间提取并脱敏真实上游错误；直接 ACP 错误保持原样透传。
