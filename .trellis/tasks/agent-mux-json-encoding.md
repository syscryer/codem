# Task: Agent Mux JSON 中文编码兼容

## Background

Windows 外部 Agent 调用 `codem-agent-mux agents --json` 时，调用方终端可能按 GBK 解码 CLI 输出中的 UTF-8 中文，导致 `nickname`、`role` 和 `tags` 显示为乱码。字段与数据库内容本身正确，但调用方必须额外读取 Unicode 码点才能恢复名称，破坏了 Skill 的直接消费体验。

## Objective

确保 Windows 外部 Agent 读取 Agent Mux JSON 时无需手工处理编码即可得到正确中文昵称和标签

## Scope

In scope:

- Agent Mux CLI 的机器可读 JSON 输出统一转义非 ASCII 字符。
- 保证 JSON 反解析后仍得到原始中文和 emoji。
- 为中文昵称、中文标签和 UTF-16 代理对增加回归测试。

Out of scope:

- 不修改数据库中的原始文本。
- 不修改 CodeM 页面显示、普通文本列表和 Agent 实时回答。
- 不改变 Agent Mux HTTP API 的 UTF-8 JSON 契约。

## Impact

- `src-tauri/src/bin/codem-agent-mux.rs` 的 `ensure`、`agents --json`、`status` 和 `cancel` 输出。
- 外部 Agent 通过 Skill 读取 profile 昵称、角色和标签的稳定性。

## Acceptance Criteria

- [ ] CLI 机器 JSON 输出仅包含 ASCII 字节，避免 Windows 代码页误解码。
- [ ] JSON 解析后 `nickname` 仍为“小猫”，中文角色和标签保持不变。
- [ ] emoji 使用合法 JSON UTF-16 代理对并可完整反解析。
- [ ] 普通文本输出和 HTTP API 不受影响。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- 真实执行 `codem-agent-mux agents --json`，确认原始输出为 ASCII 且 JSON 解析得到 `nickname=小猫`。
- `git diff --check`

## Implementation Record
- 2026-08-06T08:45:40.203Z Agent Mux CLI 的 ensure、agents --json、status、cancel 统一使用 ASCII 安全 JSON 序列化；中文按 UTF-16 单元转为合法 \\uXXXX，emoji 使用代理对。新增中文昵称、标签和 emoji 反解析回归测试。

- 2026-08-06T08:24:04.298Z Task created by Trellis automation.

## Verification Results
- 2026-08-06T08:46:21.560Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux; cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux; real agents --json parse; git diff --check`: 10 个 Rust 单测通过；格式与差异检查通过；停止旧 Runtime 后二进制构建通过；真实 CLI 原始 JSON 为纯 ASCII，PowerShell 直接反解析得到 nickname=小猫、role=小任务、tags=快速修改；桌面开发进程已重启。

## Completion Summary
- 2026-08-06T08:46:30.766Z 修复 Agent Mux CLI 在 Windows 外部 Agent 调用链中的中文 JSON 乱码：所有机器 JSON 输出使用 ASCII 安全 Unicode 转义，解析后保留中文昵称、角色、标签和 emoji；真实 CLI 与桌面开发环境验收通过。

## Follow-ups

- 暂无。
