# Task: 修复 Agent Mux 空事件文本

## Background

`codem-agent-mux` 会把 Claude Runtime 的结构化事件转存到 Agent Mux 运行事件接口。当前文本选择逻辑只判断 `message`、`label`、`name` 字段是否存在，不会跳过空字符串或纯空白值；因此上游事件包含显式空字段时，CLI 会向服务端提交空 `message`，触发 400 `运行事件缺少类型或内容`，并中断整个子 Agent 调用。

## Objective

过滤 Runtime 事件中的空白 message、label、name 并回退 event_type，避免工具调用触发 400，同时补充回归测试

## Scope

In scope:

- 在 `src-tauri/src/bin/codem-agent-mux.rs` 归一化 Runtime 事件展示文本。
- 按 `message`、`label`、`name` 顺序选择首个非空白字符串，均为空时回退到 `event_type`。
- 补充空工具名称和字段优先级的 Rust 单元回归测试。

Out of scope:

- 不放宽 Agent Mux 服务端对空事件类型或空内容的校验。
- 不修改 Runtime 原始事件 payload、事件类型或前端消费协议。
- 不调整 Agent Mux Profile 的模型、思考等级或权限配置。

## Impact

- CLI Runtime 事件转存：`src-tauri/src/bin/codem-agent-mux.rs`
- Trellis 任务与 session 验收记录。

## Acceptance Criteria

- [x] 显式空白 `message` 或 `label` 不会遮挡后续有效字段。
- [x] `message`、`label`、`name` 均为空白时使用非空 `event_type`。
- [x] 正常 `tool-start` 名称仍显示为 `调用工具：<name>`，原始 payload 保持不变。
- [x] `codem-agent-mux` 定向 Rust 测试通过，格式检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

## Implementation Record
- 2026-08-06T18:15:06.490Z 已安装 Rust stable MSVC 与 Visual Studio Build Tools，完成 codem-agent-mux 格式检查、定向单测和真实只读调用。桌面开发模式已启动。

- 2026-08-06T17:25:17.186Z 已实现 runtime_event_message：逐项 trim 并跳过空白 message、label、name，最终回退 event_type；consume_event 保留既有工具前缀、忽略告警与 payload 转存逻辑。新增空字段遮挡及空工具名称回归测试。
- 2026-08-06T17:22:09.018Z 边界确认：仅调整 codem-agent-mux CLI 的事件展示文本归一化；保持原始 payload、服务端非空校验、事件类型和前端消费协议不变。验收覆盖空字段逐级回退、event_type 兜底及正常工具名。

- 2026-08-06T17:22:08.727Z Task created by Trellis automation.

## Verification Results
- 2026-08-06T18:15:57.847Z `src-tauri/target/debug/codem-agent-mux.exe invoke --profile claude-claude code-glm-5.2-1786034860681 --permission default --prompt 'Read README.md...'`: 通过：运行 mux-dd660bba-a0a9-4941-88b3-fe942bc9df87 为 completed，耗时 11 秒，返回 # CodeM；未出现 400 空事件错误。

- 2026-08-06T18:15:57.564Z `npm run desktop:dev`: 通过：CodeM 开发窗口已启动，Vite 运行于 http://127.0.0.1:5175。
- 2026-08-06T18:15:57.264Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: 通过：12 passed，含两个新增空事件回归用例。

- 2026-08-06T18:15:56.958Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过：在 Visual Studio MSVC 开发者环境执行。
- 2026-08-06T17:27:34.711Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: 环境阻断：当前 PATH 无 cargo，无法编译运行新增 Rust 回归测试。

- 2026-08-06T17:27:34.426Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 环境阻断：当前 PATH 无 cargo，且本机未发现 rustup/cargo，未能执行。
- 2026-08-06T17:27:34.158Z `git diff --check`: 通过：源码与 Trellis 记录无空白错误。

## Completion Summary

- 2026-08-06T18:16:18.745Z 已在新装 Rust MSVC 工具链上通过格式检查与 12 项 codem-agent-mux 单测；桌面开发模式已启动；新编译 CLI 的真实 README 读取调用 completed 并返回 # CodeM，工具事件链未再触发 400。
- 2026-08-06T17:28:28.010Z 已修复 Agent Mux Runtime 事件空文本归一化并补两条回归测试；git diff --check 通过。当前机器未安装 cargo/rustup，Rust 格式检查、定向测试及新二进制真实调用验证待在具备 Rust 工具链的环境完成。

## Follow-ups

- 发布或重启使用新二进制后，再用真实 Claude Code Profile 验证读取文件工具链路。
