# Session Record: 补全 Agent Mux 事件空内容保护

- Session: session-20260806-182430-97kd
- Started: 2026-08-06T18:24:30.286Z
- Task: .trellis/tasks/agent-mux-event-message-guard.md

## Notes

- 2026-08-06T18:29:57.459Z 统一 ApiClient::event 出站边界的空白消息归一化：message -> event_type，空 event_type 在本地拒绝；补充空字段、空工具名和出站回退回归测试。
- 2026-08-06T18:24:30.556Z 已复现：debug codem-agent-mux 在 D:\project\model-forge 运行树样式任务时生成 mux-02982d36-125a-4928-82aa-757fc77bcef7，5 秒后以运行事件缺少类型或内容 400 失败；D:\project\codem 的简单读取任务此前成功。

- 2026-08-06T18:24:30.289Z Session started.

## Verification

- 2026-08-06T18:30:12.194Z `codem-agent-mux invoke --prompt <只读 AGENTS.md 标题与目录检查> --profile claude-claude code-glm-5.2-1786034860681 --working-directory D:\project\model-forge --permission default`: pass
- 2026-08-06T18:30:11.780Z `cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass

- 2026-08-06T18:30:11.345Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass
- 2026-08-06T18:30:10.832Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

## Completed

- 2026-08-06T18:30:21.077Z 已修复 Agent Mux CLI 事件出站边界：空白 message 回退到非空 event_type，空 event_type 在本地返回明确错误；补充空字段、空工具名称与出站消息归一化回归测试。cargo fmt 检查、13 项 codem-agent-mux 定向测试、debug CLI 构建均通过；使用新构建 CLI 在 D:\project\model-forge 执行包含 AGENTS.md 读取和目录检查的只读工具链调用，退出码 0，未再出现 400。
