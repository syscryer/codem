# Session Record: 验证并安装 Agent Mux 长任务事件修复

- Session: session-20260807-054819-brjh
- Started: 2026-08-07T05:48:19.403Z
- Task: .trellis/tasks/agent-mux-event-message-guard.md

## Notes
- 2026-08-07T05:54:31.688Z 确认安装版二进制仍为旧 SHA-256 74501af7...，调试版原始长提示词退出码 0；正常停止旧 Runtime，备份旧 exe 后同步调试版到 LocalAppData 并重新启动。

- 2026-08-07T05:48:19.405Z Session started.

## Verification
- 2026-08-07T05:54:33.786Z `debug and installed codem-agent-mux SHA-256`: pass: both a7cdcff4851a0ebeefcd8b9b85054224fa17e4c3a364c9c58e194f1c59b054af

- 2026-08-07T05:54:33.358Z `installed codem-agent-mux invoke --prompt PostgreSQL long read-only check`: pass: exit 0, 127.0.0.1:55432 and no fake success
- 2026-08-07T05:54:32.909Z `installed codem-agent-mux invoke --prompt Reply exactly: OK`: pass: exit 0, OK

- 2026-08-07T05:54:32.491Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass: 13/13
- 2026-08-07T05:54:32.094Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

## Completed

- 2026-08-07T05:54:42.962Z Agent Mux 空事件根因修复保持最小共享边界方案；原始长提示词在调试版及同步后的安装版均退出码 0，短任务同样通过。安装版已重启，SHA-256 与调试版一致；旧安装 exe 已备份为 codem-agent-mux.exe.bak-20260807-before-event-fix。reasoningEffort 仍为 null，但与本次 400 无关。
