# Task: 修正 OpenCode 网络错误终态

## Background

OpenCode CLI 1.18.15 在 Provider 多次断连和 `Service Unavailable` 后，把最终空步骤记录为
`finish: unknown`，ACP 最终只返回 `stopReason: end_turn`。CodeM 第一版修复误把最后一个
可见 ACP `messageId` 当成底层最终消息，因而产生了“未返回完整回复”的假错误。

同机 OpenCode 桌面端和 npm 最新版均为 1.18.20。上游 1.18.20 已增加
`network_error` finish reason 的显式失败处理，并将网络重试限制为 5 次。

## Objective

撤销错误的消息 ID 完整性推断，升级 OpenCode CLI 并验证 network_error 由上游正确终止和上报

## Scope

In scope:

- 撤销 CodeM 基于 ACP `messageId` 和公开文本的完整性推断。
- 保持 ACP `stopReason` 为客户端终态事实来源。
- 增加不同消息 ID 的 text/thought 更新仍接受 `end_turn` 的回归测试。
- 将 CodeM 实际启动的全局 OpenCode CLI 从 1.18.15 升级到 1.18.20。
- 重启桌面开发版并验证最新二进制、Mux 和端口。

Out of scope:

- 在 CodeM 中复制 OpenCode 的 session/retry 状态机。
- 解析 OpenCode 私有 SQLite 或日志来决定通用 ACP 终态。
- 修改 OpenCode 桌面端。

## Impact

- Backend: `src-tauri/src/acp.rs` 仅保留协议回归测试，撤销错误实现。
- Runtime: 全局 `opencode-ai` 升级为 1.18.20，后续 ACP 热会话使用新版。
- Frontend contract: 不变；真实 ACP RPC 错误继续走现有 error terminal event。

## Acceptance Criteria

- [x] 不再因 thought/tool 使用不同 `messageId` 而生成 CodeM 假错误。
- [x] OpenCode CLI 与桌面端对齐为 1.18.20。
- [x] 上游 1.18.20 的 `network_error` 识别和 5 次重试上限已由源码差异确认。
- [x] ACP 定向测试、Rust 全量测试、格式、类型和空白检查通过。
- [x] 桌面开发版已重启并使用最新 debug 二进制。

## Verification Commands

- `opencode --version`
- `cargo test --manifest-path src-tauri/Cargo.toml acp_prompt_accepts_end_turn_after_updates_with_distinct_message_ids`
- `cargo test --manifest-path src-tauri/Cargo.toml --quiet`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- `git diff --check`
- 检查 debug CodeM/Mux PID、二进制时间和监听端口。

## Implementation Record

- 2026-08-21T08:52:52.945Z 版本对照：CodeM 全局 CLI 原为 1.18.15，OpenCode 桌面端与 npm 最新为 1.18.20；上游 1.18.20 新增 network_error finish reason 失败识别并限制最多 5 次重试。已升级全局 CLI 并由真实 ACP initialize 确认 agentInfo.version=1.18.20。
- 2026-08-21T08:52:52.319Z 真实会话证据：本轮 16:15:52 开始、16:28:55 才 idle；期间多次 socket closed/Service Unavailable，最终空消息 finish=unknown。截图中的 msg_023689... 是倒数第二个 tool-call 消息，不是底层最终消息，因此撤销 messageId 完整性推断。

- 2026-08-21T08:40:57.859Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T08:53:11.243Z `desktop development restart`: pass: debug codem PID 83624, dev mux PID 49816; binaries rebuilt at 16:49; ports 5173/53061/3210 listening; mux health returned expected 401 auth response

- 2026-08-21T08:53:10.638Z `rtk cargo fmt --manifest-path src-tauri/Cargo.toml --check; rtk npm run typecheck; rtk git diff --check`: pass: formatting, TypeScript and whitespace checks passed
- 2026-08-21T08:53:10.024Z `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --quiet`: pass: 576 + 14 + 21 passed, 1 ignored, exit 0

- 2026-08-21T08:53:09.413Z `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml acp_prompt_accepts_end_turn_after_updates_with_distinct_message_ids --quiet`: pass: 1 passed, 0 failed
- 2026-08-21T08:53:08.809Z `opencode --version and ACP initialize`: pass: global CLI and real ACP agentInfo both report 1.18.20

## Completion Summary
- 2026-08-21T08:53:23.200Z 撤销基于 ACP messageId 的错误完整性推断；确认根因是 OpenCode 1.18.15 对 Provider network_error 漏判为 finish=unknown，并将全局 CLI 升级到 1.18.20。协议回归、全量测试、真实 ACP 握手和桌面开发重启均通过。

## Follow-ups

- 若 1.18.20 仍出现 `finish: unknown`，保留该次完整 session export 和 Provider 日志向 OpenCode 上游报告；不要恢复客户端文本启发式判错。
