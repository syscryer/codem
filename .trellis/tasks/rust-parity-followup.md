# Task: Rust 重构原版差异连续审计

## Background

待补充背景。

## Objective

按顺序完成 Claude 运行流、历史持久化、Git/文件接口和桌面端真实场景的原版差异审计与修复

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- 2026-07-05T10:56:00.196Z 已重启桌面开发实例到新 Rust 后端：停止旧 desktop-dev/codem.exe 后用隐藏 cmd 启动 npm run desktop:dev；当前 5173 由 Vite 监听，3080 由 src-tauri\\target\\debug\\codem.exe 监听。
- 2026-07-05T10:55:19.526Z 修复 Rust Claude human-input 暂停语义：control_request 提问/审批按原版立即返回；assistant snapshot 遇到 RequestUserInput/ApprovalRequest 后不继续解析同 payload；request/approval 事件先于 paused trace 入队；session 事件改为 sessionId 变化时才发，避免暂停后重复 session 噪音。

- 2026-07-05T05:35:02.570Z 全接口综合 harness 首轮 93 项中 13 项不一致，已开始按原版修复 MCP/plugin 错误体、Claude 人机交互错误体、runtime context/runtimes 返回形态、git clone/pull/undo/commit/conflict 字段。
- 2026-07-05T04:49:35.595Z 继续原版接口对照：修复 Git 写操作差异，commit 空 files 按原版拒绝，switch 返回 Git summary，branch/delete 使用安全删除并禁止删除当前分支，worktree create 在 addProject=false 时不返回 workspace；调整 ApiError 默认文本响应，仅 usage invalid 使用 JSON 错误；补齐 Claude result usage 事件，并让 /api/claude/run/:id/events replay 过滤 raw/trace/assistant-snapshot/claude-event。

- 2026-07-05T04:18:40.636Z 继续对照原版接口，修复 Rust /api/usage 统计口径与 range 参数：按 turn 去重聚合 token/费用/工具/消息，补齐 range/project 过滤、provider 推断和 JSON 错误响应；修复 Codex MCP TOML 子表误识别为 server；按原版固定层级扫描 Claude plugin cache，并为无 frontmatter 的用户 skill 使用目录名 fallback。
- 2026-07-05T03:15:28.602Z 对照原版 Git/文件接口，确认路由覆盖一致；修复 Rust /api/projects/:id/git/diff，使其合并 staged+unstaged diff，并按原版处理未跟踪文件和删除文件的 before/afterContent。

- 2026-07-05T03:09:36.671Z 对照原版历史恢复逻辑，Rust 后端补齐 /api/threads/:threadId/history 的 transcript 解析与刷新写回：SQLite 优先，必要时从 Claude JSONL 恢复 turns，并保留 context snapshot、tool/tool_result、sidechain、pending 请求、usage 和本地污染清理。
- 2026-07-05T02:56:13.667Z 真实接口验证：创建 D:\\ai_proj\\codem 项目与测试线程；/api/claude/run 最小 turn 返回 done=OK；运行中 /guide 返回 submitted=true 且事件中有 stdin_guide_prompt_written；/interrupt 返回 submitted=true 且事件中有 stdin_interrupt_written；尝试触发 AI 提问卡片未成功，Claude 直接 exit code 1，暂停态 guide 拒绝待后续稳定场景复测。

- 2026-07-05T02:47:34.396Z 继续对照原版 Claude stdout 事件，补齐 system/api_retry 与 system/status=requesting 的 phase 事件，并将 result 错误从 done 改为 retryable-error/error 终态。
- 2026-07-05T02:44:21.491Z 对照原版 Claude 运行流，Rust 后端补齐 stderr retry phase、runtime-reconnect-hint/retryable-error 恢复事件、运行中 guide 暂停保护，以及 guide/interrupt 写 stdin 失败时的原版式错误事件。

- 2026-07-05T02:12:56.401Z Task created by Trellis automation.

## Verification Results

- 2026-07-05T10:55:49.295Z `real /api/claude/run human-input parity on 3090 vs 3081 and restarted 3080`: 通过：同一 AskUserQuestion/RequestUserInput prompt 下，原版 3090 提问后 visibleAfter=[]；新 Rust 3081 提问后 visibleAfter=[]，无额外 approval-request；重启后的桌面 3080 复测 request-user-input 后仅 trace/raw/assistant-snapshot，visibleAfter=[]。Plan ExitPlanMode 审批对照：3090 与 3081 均为 approval-request 后保留 tool-stop，行为一致。
- 2026-07-05T10:55:35.740Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：fmt/check/typecheck 均成功；git diff --check 仅提示 src-tauri/src/backend.rs 工作区 LF 将被 Git 转 CRLF，无空白错误。

- 2026-07-05T05:51:42.426Z `real /api/claude/run parity on 3090 vs 3081`: 真实 Claude 最小消息两端均成功完成，事件流包含 done 和 usage 且无 error；events replay 两端均过滤 raw/trace/assistant-snapshot/claude-event。
- 2026-07-05T05:49:28.828Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; 3090 vs 3081 API parity harness`: Rust 后端和桌面 bin 检查通过；前端 typecheck 通过；git diff --check 仅 Windows LF/CRLF 提示；全接口原版对照首轮 93 项剩 13 项，修复后定向复测全部通过；顺序重试广覆盖 78 项剩 2 项，修复 guide/interrupt 后两项定向通过。

- 2026-07-05T04:49:35.638Z `Git 写操作与 Claude NDJSON 真实对照`: 通过：原版 3090 与 Rust 3081 对照 add-files、commit 空 files/正常 commit、branch、switch、branch/delete、worktree create、push-preview 错误体、usage invalid 错误体均对齐；Claude 最小 run content-type、phase、done、usage、replay 过滤、active=false 对齐；审批探针未触发 approval-request，两端均完成无错误，工具事件还需后续用稳定 fixture 或强制场景继续验证。
- 2026-07-05T04:18:40.661Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; desktop health`: 通过：两个 Rust bin 编译检查成功，前端 typecheck 成功，git diff --check 无 whitespace 错误；重启桌面 dev 后 /api/health available=true，5173 返回 HTTP 200。

- 2026-07-05T04:18:40.655Z `原版 3090 与 Rust 3091 真实接口对照`: 通过：/api/usage all/range/project/invalid 与原版关键统计一致；settings PUT、system-prompt GET/PUT、MCP servers/configs、plugin installed/marketplaces/skills/command、slash commands、attachments image/image-from-path、file/image preview、project/thread CRUD 均与原版结构和关键字段对齐。
- 2026-07-05T03:16:39.334Z `final checks`: 通过：cargo check --bin codem-backend、cargo check --bin codem、npm run typecheck、git diff --check 均成功；/api/health 返回 available=true；Web 5173 返回 HTTP 200。

- 2026-07-05T03:15:28.684Z `Git/file API smoke`: 通过：git summary/status/branches/history/commit/file-preview/files/resolve/push-preview/worktrees 可用；diff 修改文件返回 diff --git，未跟踪文件返回原版式 未跟踪文件 前缀。
- 2026-07-05T03:09:36.672Z `GET /api/threads/:id/history imported transcript + PUT/GET roundtrip`: 通过：真实 imported 线程从 transcript 恢复 4 个 turns、首轮 58 items/26 tools；测试线程 PUT/GET 保留 userContentBlocks=2、pendingApprovalRequests=1、items=3、subtools=1、subMessages=1、usage/cost 字段。

- 2026-07-05T02:47:34.397Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri\\Cargo.toml --bin codem`: 通过，补齐 stdout retry/status/result 错误映射后两个 Rust bin 仍可编译。
- 2026-07-05T02:44:21.504Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri\\Cargo.toml --bin codem`: 通过，Rust 后端与桌面 bin 编译检查均成功。

## Completion Summary
- 2026-07-05T03:16:39.353Z 完成 Rust 重构与原版差异的本轮连续推进：补齐 Claude 运行流 recovery/guide/interrupt/result 错误语义；补齐历史 transcript 解析与刷新写回；修复 Git diff staged/unstaged/未跟踪文件语义；完成真实 Claude、历史、Git/文件和桌面 dev 验证。

## Follow-ups

- 待补充。
