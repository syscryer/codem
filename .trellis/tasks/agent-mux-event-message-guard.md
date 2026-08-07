# Task: 补全 Agent Mux 事件空内容保护

## Background

`runtime_event_message` 已覆盖工具/状态事件中的空白字段，但 `ApiClient::event` 的其他调用（尤其 `error` 事件）仍可把显式空字符串直接提交到 Agent Mux 服务端。ModelForge 工作区的真实树任务仍因此失败并返回 400 `运行事件缺少类型或内容`。

## Objective

在 CLI 事件出站边界统一回退空白 message，修复 ModelForge 工作区调用仍触发的 400

## Scope

In scope:

- 在 `src-tauri/src/bin/codem-agent-mux.rs` 的事件出站边界统一过滤空白内容并回退 `event_type`。
- 增加空错误事件等回归测试。
- 用 ModelForge 工作区真实子代理调用复测。

Out of scope:

- 不修改服务端空事件校验。
- 不修改事件 payload、Profile 配置、权限参数或前端项目代码。

## Impact

- Agent Mux CLI 事件提交：`src-tauri/src/bin/codem-agent-mux.rs`
- Trellis 任务与 session 验收记录。

## Acceptance Criteria

- [ ] 空白 message 不会从任何 CLI `api.event` 出口提交。
- [ ] 非空 event_type 可作为空 message 的回退值。
- [ ] 正常事件 payload 与消息内容保持不变。
- [ ] Rust 格式检查、定向单测和 ModelForge 真实调用通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `src-tauri/target/debug/codem-agent-mux.exe invoke ... --working-directory D:\project\model-forge`

## Implementation Record
- 2026-08-07T05:54:31.688Z 确认安装版二进制仍为旧 SHA-256 74501af7...，调试版原始长提示词退出码 0；正常停止旧 Runtime，备份旧 exe 后同步调试版到 LocalAppData 并重新启动。

- 2026-08-06T18:29:57.459Z 统一 ApiClient::event 出站边界的空白消息归一化：message -> event_type，空 event_type 在本地拒绝；补充空字段、空工具名和出站回退回归测试。
- 2026-08-06T18:24:30.556Z 已复现：debug codem-agent-mux 在 D:\project\model-forge 运行树样式任务时生成 mux-02982d36-125a-4928-82aa-757fc77bcef7，5 秒后以运行事件缺少类型或内容 400 失败；D:\project\codem 的简单读取任务此前成功。

- 2026-08-06T18:24:30.287Z Task created by Trellis automation.

## Verification Results
- 2026-08-07T05:54:33.786Z `debug and installed codem-agent-mux SHA-256`: pass: both a7cdcff4851a0ebeefcd8b9b85054224fa17e4c3a364c9c58e194f1c59b054af

- 2026-08-07T05:54:33.358Z `installed codem-agent-mux invoke --prompt PostgreSQL long read-only check`: pass: exit 0, 127.0.0.1:55432 and no fake success
- 2026-08-07T05:54:32.909Z `installed codem-agent-mux invoke --prompt Reply exactly: OK`: pass: exit 0, OK

- 2026-08-07T05:54:32.491Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass: 13/13
- 2026-08-07T05:54:32.094Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

- 2026-08-06T18:30:12.194Z `codem-agent-mux invoke --prompt <只读 AGENTS.md 标题与目录检查> --profile claude-claude code-glm-5.2-1786034860681 --working-directory D:\project\model-forge --permission default`: pass
- 2026-08-06T18:30:11.780Z `cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass

- 2026-08-06T18:30:11.345Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass
- 2026-08-06T18:30:10.832Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

## Completion Summary

- 2026-08-07T05:54:42.962Z Agent Mux 空事件根因修复保持最小共享边界方案；原始长提示词在调试版及同步后的安装版均退出码 0，短任务同样通过。安装版已重启，SHA-256 与调试版一致；旧安装 exe 已备份为 codem-agent-mux.exe.bak-20260807-before-event-fix。reasoningEffort 仍为 null，但与本次 400 无关。
- 2026-08-06T18:30:21.077Z 已修复 Agent Mux CLI 事件出站边界：空白 message 回退到非空 event_type，空 event_type 在本地返回明确错误；补充空字段、空工具名称与出站消息归一化回归测试。cargo fmt 检查、13 项 codem-agent-mux 定向测试、debug CLI 构建均通过；使用新构建 CLI 在 D:\project\model-forge 执行包含 AGENTS.md 读取和目录检查的只读工具链调用，退出码 0，未再出现 400。

## Follow-ups

- 保持开发桌面进程运行，便于用户继续复测；发布前重新构建正式 CLI。
