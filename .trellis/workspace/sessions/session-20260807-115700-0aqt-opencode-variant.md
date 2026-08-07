# Session Record: OpenCode 思考等级选择

- Session: session-20260807-115700-0aqt
- Started: 2026-08-07T11:57:00.001Z
- Task: .trellis/tasks/opencode-variant.md

## Notes
- 2026-08-07T11:59:12.148Z 核对 OpenCode 最新源码与本机 1.18.15 ACP：思考配置项 ID 为 effort；自定义 variants 注入后 high/max 可被 effort 接受，variant 会返回 unknown config option。已修正 ACP 透传入口。

- 2026-08-07T11:57:00.003Z Session started.

## Verification
- 2026-08-07T12:01:20.602Z `cargo test --manifest-path src-tauri/Cargo.toml --lib；cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check；本机 opencode 1.18.15 ACP 协议探针`: 通过：443 passed、1 ignored；格式与差异检查通过；自定义 GLM-5.2 返回 effort(high,max)，variant 被拒绝，effort=high 被接受；桌面与 Agent Mux 已自动重编译重启且 Responding=true

## Completed

- 2026-08-07T12:01:34.353Z 修正 OpenCode ACP 思考等级配置 ID：CodeM 现按 OpenCode 统一 effort 入口透传模型 variant；源码与本机 1.18.15 实测确认不支持任意等级自动映射，模型能力仍以 variants 为准。
