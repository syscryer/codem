# Session Record: 修复 DSH Web 参数顺序

- Session: session-20260813-152824-mgr6
- Started: 2026-08-13T15:28:24.348Z
- Task: .trellis/tasks/deepseek-dsh-web-command-order.md

## Notes
- 2026-08-13T15:33:19.695Z 根因确认：DSH 0.1.0-rc.6 的 web 子命令是 --profile web 的别名，但带父级 --patch 时不能使用 dsh --patch <file> web；必须使用 dsh --profile web --patch <file> --host ... --port ...。已将托管 Host 参数改为该顺序，并抽出 web_arguments 供回归测试直接覆盖。

- 2026-08-13T15:28:24.350Z Session started.

## Verification

- 2026-08-13T15:33:20.954Z `真实 Runtime POST /api/agents/run，providerId=deepseek-dsh，model=deepseek-chat`: 成功创建 session-5c10831c-cff4-4ee8-bcfa-e09e286306ae，产生 thinking-delta 与 delta=OK，最终 done；未再出现 web takes none of parent --patch 错误
- 2026-08-13T15:33:20.633Z `git diff --check`: 通过，仅有既有 Windows 换行提示

- 2026-08-13T15:33:20.323Z `cargo test --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 5/5 通过
- 2026-08-13T15:33:20.011Z `cargo test --manifest-path src-tauri/Cargo.toml web_profile_precedes_patch_and_web_arguments -- --nocapture`: 1/1 通过，直接验证生产参数顺序

## Completed

- 2026-08-13T15:33:21.279Z 修复 DSH Web Host 带模型 Patch 时的启动参数顺序：改用 dsh --profile web --patch ...，新增生产参数回归测试，重启桌面与 0.1.24 Runtime，并通过真实 DeepSeek DSH 热会话验证流式输出和完成事件。
