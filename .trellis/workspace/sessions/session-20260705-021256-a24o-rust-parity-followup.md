# Session Record: Rust 重构原版差异连续审计

- Session: session-20260705-021256-a24o
- Started: 2026-07-05T02:12:56.399Z
- Task: .trellis/tasks/rust-parity-followup.md

## Notes
- 2026-07-05T03:15:28.602Z 对照原版 Git/文件接口，确认路由覆盖一致；修复 Rust /api/projects/:id/git/diff，使其合并 staged+unstaged diff，并按原版处理未跟踪文件和删除文件的 before/afterContent。

- 2026-07-05T03:09:36.671Z 对照原版历史恢复逻辑，Rust 后端补齐 /api/threads/:threadId/history 的 transcript 解析与刷新写回：SQLite 优先，必要时从 Claude JSONL 恢复 turns，并保留 context snapshot、tool/tool_result、sidechain、pending 请求、usage 和本地污染清理。
- 2026-07-05T02:56:13.667Z 真实接口验证：创建 D:\\ai_proj\\codem 项目与测试线程；/api/claude/run 最小 turn 返回 done=OK；运行中 /guide 返回 submitted=true 且事件中有 stdin_guide_prompt_written；/interrupt 返回 submitted=true 且事件中有 stdin_interrupt_written；尝试触发 AI 提问卡片未成功，Claude 直接 exit code 1，暂停态 guide 拒绝待后续稳定场景复测。

- 2026-07-05T02:47:34.396Z 继续对照原版 Claude stdout 事件，补齐 system/api_retry 与 system/status=requesting 的 phase 事件，并将 result 错误从 done 改为 retryable-error/error 终态。
- 2026-07-05T02:44:21.491Z 对照原版 Claude 运行流，Rust 后端补齐 stderr retry phase、runtime-reconnect-hint/retryable-error 恢复事件、运行中 guide 暂停保护，以及 guide/interrupt 写 stdin 失败时的原版式错误事件。

- 2026-07-05T02:12:56.402Z Session started.

## Verification
- 2026-07-05T03:16:39.334Z `final checks`: 通过：cargo check --bin codem-backend、cargo check --bin codem、npm run typecheck、git diff --check 均成功；/api/health 返回 available=true；Web 5173 返回 HTTP 200。

- 2026-07-05T03:15:28.684Z `Git/file API smoke`: 通过：git summary/status/branches/history/commit/file-preview/files/resolve/push-preview/worktrees 可用；diff 修改文件返回 diff --git，未跟踪文件返回原版式 未跟踪文件 前缀。
- 2026-07-05T03:09:36.672Z `GET /api/threads/:id/history imported transcript + PUT/GET roundtrip`: 通过：真实 imported 线程从 transcript 恢复 4 个 turns、首轮 58 items/26 tools；测试线程 PUT/GET 保留 userContentBlocks=2、pendingApprovalRequests=1、items=3、subtools=1、subMessages=1、usage/cost 字段。

- 2026-07-05T02:47:34.397Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri\\Cargo.toml --bin codem`: 通过，补齐 stdout retry/status/result 错误映射后两个 Rust bin 仍可编译。
- 2026-07-05T02:44:21.504Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri\\Cargo.toml --bin codem`: 通过，Rust 后端与桌面 bin 编译检查均成功。

## Completed

- 2026-07-05T03:16:39.353Z 完成 Rust 重构与原版差异的本轮连续推进：补齐 Claude 运行流 recovery/guide/interrupt/result 错误语义；补齐历史 transcript 解析与刷新写回；修复 Git diff staged/unstaged/未跟踪文件语义；完成真实 Claude、历史、Git/文件和桌面 dev 验证。
