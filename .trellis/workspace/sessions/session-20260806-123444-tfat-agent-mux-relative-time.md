# Session Record: 修复 Agent Mux 相对时间

- Session: session-20260806-123444-tfat
- Started: 2026-08-06T12:34:44.618Z
- Task: .trellis/tasks/agent-mux-relative-time.md

## Notes

- 2026-08-06T12:53:06.773Z 实现 createdAt 跨层字段与统一 UTC 相对时间格式化；监控列表改为真实创建时间并提供精确时间 tooltip，started 仅作兼容兜底。已重建并重启 CodeM Dev Agent Mux Runtime 与桌面壳。
- 2026-08-06T12:38:40.743Z 确认根因：agent_mux_runs.created_at 保存了正确 UTC 时间，但 RunRecord/API 未暴露该字段，监控列表持续渲染持久化的 started='刚刚'。修复将直接使用 created_at，兼容旧 started 字段且不迁移数据库。

- 2026-08-06T12:34:44.622Z Session started.

## Verification

- 2026-08-06T12:53:49.395Z `authenticated CodeM Dev Agent Mux overview API`: pass: createdAt returned and live labels resolved to 33 分钟前 / 4 小时前
- 2026-08-06T12:53:41.199Z `npm run typecheck; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; git diff --check`: pass

- 2026-08-06T12:53:34.146Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests::run_records_expose_the_persisted_utc_creation_time`: pass: 1 test
- 2026-08-06T12:53:26.306Z `node --import tsx --test src/lib/agent-mux-events.test.ts src/lib/agent-mux-conversations.test.ts src/lib/agent-mux-ui.test.ts`: pass: 22 tests

## Completed

- 2026-08-06T12:54:03.153Z 修复 Agent Mux 运行监控永久显示刚刚：API 暴露真实 UTC createdAt，前端按本地当前时间显示分钟/小时/天级相对时间，旧字段仅兼容兜底；真实桌面 API 已验证。
