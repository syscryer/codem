# Session Record: 修复 DSH 上下文圈显示

- Session: session-20260813-174505-y0i9
- Started: 2026-08-13T17:45:05.050Z
- Task: .trellis/tasks/dsh-model-reasoning-usage.md

## Notes
- 2026-08-14T01:23:19.892Z 补充 DSH 会话投影只读接口；已有 DSH 会话缺少 contextUsage 时自动读取 session.history(includeProjections=true)，合并到最后一轮并持久化。

- 2026-08-13T17:45:05.052Z Session started.

## Verification
- 2026-08-14T01:23:21.185Z `CodeM Dev 真实会话回填`: session-855943e2 已写入 25876/1000000 及系统提示词、工具、对话消息、运行统计

- 2026-08-14T01:23:20.917Z `npm.cmd run build`: TypeScript 与 Vite 生产构建通过
- 2026-08-14T01:23:20.668Z `node --import tsx --test src/lib/settings-api.test.ts src/lib/composer-context-usage.test.ts`: 24 项测试通过

- 2026-08-14T01:23:20.410Z `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 7 项 DSH 测试通过
- 2026-08-14T01:23:20.154Z `cargo check -q --manifest-path src-tauri/Cargo.toml`: 通过，仅既有 dead_code 警告

## Completed

- 2026-08-14T01:23:21.452Z DSH 上下文小圈支持旧会话自动补拉原生投影；当前真实会话已回填并持久化，桌面开发版已重启。
