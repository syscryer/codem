# Session Record: Rust 重构原版差异继续审计

- Session: session-20260705-035331-4ac5
- Started: 2026-07-05T03:53:31.202Z
- Task: .trellis/tasks/rust-parity-followup.md

## Notes
- 2026-07-05T10:56:00.196Z 已重启桌面开发实例到新 Rust 后端：停止旧 desktop-dev/codem.exe 后用隐藏 cmd 启动 npm run desktop:dev；当前 5173 由 Vite 监听，3080 由 src-tauri\\target\\debug\\codem.exe 监听。

- 2026-07-05T10:55:19.526Z 修复 Rust Claude human-input 暂停语义：control_request 提问/审批按原版立即返回；assistant snapshot 遇到 RequestUserInput/ApprovalRequest 后不继续解析同 payload；request/approval 事件先于 paused trace 入队；session 事件改为 sessionId 变化时才发，避免暂停后重复 session 噪音。
- 2026-07-05T05:35:02.570Z 全接口综合 harness 首轮 93 项中 13 项不一致，已开始按原版修复 MCP/plugin 错误体、Claude 人机交互错误体、runtime context/runtimes 返回形态、git clone/pull/undo/commit/conflict 字段。

- 2026-07-05T04:49:35.595Z 继续原版接口对照：修复 Git 写操作差异，commit 空 files 按原版拒绝，switch 返回 Git summary，branch/delete 使用安全删除并禁止删除当前分支，worktree create 在 addProject=false 时不返回 workspace；调整 ApiError 默认文本响应，仅 usage invalid 使用 JSON 错误；补齐 Claude result usage 事件，并让 /api/claude/run/:id/events replay 过滤 raw/trace/assistant-snapshot/claude-event。
- 2026-07-05T04:18:40.636Z 继续对照原版接口，修复 Rust /api/usage 统计口径与 range 参数：按 turn 去重聚合 token/费用/工具/消息，补齐 range/project 过滤、provider 推断和 JSON 错误响应；修复 Codex MCP TOML 子表误识别为 server；按原版固定层级扫描 Claude plugin cache，并为无 frontmatter 的用户 skill 使用目录名 fallback。

- 2026-07-05T03:53:31.204Z Session started.

## Verification
- 2026-07-05T10:55:49.295Z `real /api/claude/run human-input parity on 3090 vs 3081 and restarted 3080`: 通过：同一 AskUserQuestion/RequestUserInput prompt 下，原版 3090 提问后 visibleAfter=[]；新 Rust 3081 提问后 visibleAfter=[]，无额外 approval-request；重启后的桌面 3080 复测 request-user-input 后仅 trace/raw/assistant-snapshot，visibleAfter=[]。Plan ExitPlanMode 审批对照：3090 与 3081 均为 approval-request 后保留 tool-stop，行为一致。

- 2026-07-05T10:55:35.740Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：fmt/check/typecheck 均成功；git diff --check 仅提示 src-tauri/src/backend.rs 工作区 LF 将被 Git 转 CRLF，无空白错误。
- 2026-07-05T05:51:42.426Z `real /api/claude/run parity on 3090 vs 3081`: 真实 Claude 最小消息两端均成功完成，事件流包含 done 和 usage 且无 error；events replay 两端均过滤 raw/trace/assistant-snapshot/claude-event。

- 2026-07-05T05:49:28.828Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; 3090 vs 3081 API parity harness`: Rust 后端和桌面 bin 检查通过；前端 typecheck 通过；git diff --check 仅 Windows LF/CRLF 提示；全接口原版对照首轮 93 项剩 13 项，修复后定向复测全部通过；顺序重试广覆盖 78 项剩 2 项，修复 guide/interrupt 后两项定向通过。
- 2026-07-05T04:49:35.638Z `Git 写操作与 Claude NDJSON 真实对照`: 通过：原版 3090 与 Rust 3081 对照 add-files、commit 空 files/正常 commit、branch、switch、branch/delete、worktree create、push-preview 错误体、usage invalid 错误体均对齐；Claude 最小 run content-type、phase、done、usage、replay 过滤、active=false 对齐；审批探针未触发 approval-request，两端均完成无错误，工具事件还需后续用稳定 fixture 或强制场景继续验证。

- 2026-07-05T04:18:40.661Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; desktop health`: 通过：两个 Rust bin 编译检查成功，前端 typecheck 成功，git diff --check 无 whitespace 错误；重启桌面 dev 后 /api/health available=true，5173 返回 HTTP 200。
- 2026-07-05T04:18:40.655Z `原版 3090 与 Rust 3091 真实接口对照`: 通过：/api/usage all/range/project/invalid 与原版关键统计一致；settings PUT、system-prompt GET/PUT、MCP servers/configs、plugin installed/marketplaces/skills/command、slash commands、attachments image/image-from-path、file/image preview、project/thread CRUD 均与原版结构和关键字段对齐。

## Completed
