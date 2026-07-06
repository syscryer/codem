# Session Record: Rust 重构原版差异继续审计

- Session: session-20260705-035331-4ac5
- Started: 2026-07-05T03:53:31.202Z
- Task: .trellis/tasks/rust-parity-followup.md

## Notes

- 2026-07-06T09:03:07.413Z 修复打包版数据目录跑偏：Windows 桌面后端优先使用 LOCALAPPDATA\\CodeM，避免发布版落到 Roaming\\com.mnl.codem\\data 空库；已用 release 版验证 /api/workspace/bootstrap 返回 projects=50。
- 2026-07-06T08:16:12.657Z 复核 GLM 复审结论：整体判断成立，但发现 /api/claude/run/:id/ack 仍与原 Node 语义不同；原版 acknowledgeRunEvents 仅在 run finished 时返回 true 并立即 removeRunRecord，Rust 之前只要 run 存在就 true 且不删除。已修复为调用 remove_finished_run_record，运行中 ack 返回 false，完成后 ack 立即释放 run record。

- 2026-07-06T07:53:34.656Z 对照生命周期 P2：Rust handle_runtime_exit 已有 saw_done/finished 防重复错误，但正常退出且未收到 result 时仍会推 error；按原 Node close 语义修复为 exit code 0 补 done，result 使用 collected_result，非 0/等待失败仍保留 error。R7 后端线程自动重启、R8 桌面退出清理 Claude 子进程需要区分 owned/reused backend，否则可能误杀复用后端中的其他会话，暂记录为后续生命周期任务，不做半套实现。
- 2026-07-06T07:45:43.588Z 继续对照剩余路径类 P2：确认 open-system-path、git clone 任意 URL/目录、项目注册任意可访问目录均为原 Node 版既有桌面能力，不做硬白名单以免破坏功能；修复 Rust resolve_accessible_directory 未做 Node path.resolve 等价归一化的问题，统一走 resolve_absolute_path；补齐 validate_desktop_file_path 对相对 .env/.env.local 的拦截，与原版 desktop-attachment-paths 正则语义一致。

- 2026-07-06T07:36:12.910Z 继续处理 GLM review 的 P2 中不破坏现有功能的问题：新增 /api/runtime/identity 作为 Rust 后端身份探针，桌面壳只复用返回 app=codem/backend=rust 的端口；配置端口被非 CodeM 服务占用时改用新分配端口启动，避免误连旧 Node 或任意本地服务；workspace DB 初始化增加进程内互斥锁，串行化 CREATE/ensure_column 迁移，避免首启并发 ALTER TABLE 竞态。
- 2026-07-06T07:18:08.401Z 修复并验证 GLM review 中确认有依据的 P0/P1 问题：Rust CORS 复刻原 Node 本地白名单反射；文件预览路径比较改为词法归一化后校验；Skill 安装拒绝 .、..、包含 ..、控制字符和 Windows 保留字符；/api/claude/run/:id/events 改为运行中持续等待 notify；同线程 run 改为 CAS 占用 current_run_id；finished run 保留 10 分钟重连窗口后清理，删除线程/项目时清 runtime 和 run records。MCP command 白名单不采用，因为原版同样允许用户自定义本地 MCP 命令，强行白名单会破坏现有功能。

- 2026-07-06T06:40:07.785Z 评估 GLM 对 codex/rust-backend 的 review：初步确认 CORS allow_origin(Any)、路径字符串前缀校验、Skill 名称穿越、runs 无界缓存、运行中 /events 只回放不等待、同线程 run current_run_id 覆盖等问题有依据；MCP command 白名单方案会破坏自定义 MCP，优先用 CORS/路径/生命周期修复降低风险。
- 2026-07-05T10:56:00.196Z 已重启桌面开发实例到新 Rust 后端：停止旧 desktop-dev/codem.exe 后用隐藏 cmd 启动 npm run desktop:dev；当前 5173 由 Vite 监听，3080 由 src-tauri\\target\\debug\\codem.exe 监听。

- 2026-07-05T10:55:19.526Z 修复 Rust Claude human-input 暂停语义：control_request 提问/审批按原版立即返回；assistant snapshot 遇到 RequestUserInput/ApprovalRequest 后不继续解析同 payload；request/approval 事件先于 paused trace 入队；session 事件改为 sessionId 变化时才发，避免暂停后重复 session 噪音。
- 2026-07-05T05:35:02.570Z 全接口综合 harness 首轮 93 项中 13 项不一致，已开始按原版修复 MCP/plugin 错误体、Claude 人机交互错误体、runtime context/runtimes 返回形态、git clone/pull/undo/commit/conflict 字段。

- 2026-07-05T04:49:35.595Z 继续原版接口对照：修复 Git 写操作差异，commit 空 files 按原版拒绝，switch 返回 Git summary，branch/delete 使用安全删除并禁止删除当前分支，worktree create 在 addProject=false 时不返回 workspace；调整 ApiError 默认文本响应，仅 usage invalid 使用 JSON 错误；补齐 Claude result usage 事件，并让 /api/claude/run/:id/events replay 过滤 raw/trace/assistant-snapshot/claude-event。
- 2026-07-05T04:18:40.636Z 继续对照原版接口，修复 Rust /api/usage 统计口径与 range 参数：按 turn 去重聚合 token/费用/工具/消息，补齐 range/project 过滤、provider 推断和 JSON 错误响应；修复 Codex MCP TOML 子表误识别为 server；按原版固定层级扫描 Claude plugin cache，并为无 frontmatter 的用户 skill 使用目录名 fallback。

- 2026-07-05T03:53:31.204Z Session started.

## Verification

- 2026-07-06T09:19:41.311Z `release clean CODEM_APP_DATA_DIR first-run probe`: pass: 临时空数据目录启动成功，identity=codem/rust，首次 bootstrap projects=0，POST /api/projects 添加 D:\ai_proj\codem 后 bootstrap projects=1，codem.sqlite 正常创建。
- 2026-07-06T09:08:21.903Z `npm run package:win; release /api/runtime/identity; release /api/workspace/bootstrap`: pass: package:win 通过并产出 NSIS/MSI；release 日志 data=%LOCALAPPDATA%\\CodeM；identity 返回 app=codem backend=rust；bootstrap 返回 projects=50。

- 2026-07-06T08:32:59.144Z `npm run package:doctor; npm run package:win`: 通过：Doctor: OK；Windows x64 打包成功，生成 NSIS D:\\ai_proj\\codem\\src-tauri\\target\\release\\bundle\\nsis\\CodeM_0.1.9_x64-setup.exe（8776677 bytes）和 MSI D:\\ai_proj\\codem\\src-tauri\\target\\release\\bundle\\msi\\CodeM_0.1.9_x64_en-US.msi（11550720 bytes），release exe D:\\ai_proj\\codem\\src-tauri\\target\\release\\codem.exe（20721664 bytes）。Vite 有 chunk size / dynamic import warning，但构建成功。
- 2026-07-06T08:16:32.940Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：修复 ack 原版语义后 fmt、两个 Rust bin cargo check、前端 typecheck 均成功；git diff --check 仅 Windows LF/CRLF 提示。

- 2026-07-06T07:59:27.358Z `npm run desktop:dev hidden restart; GET http://127.0.0.1:3080/api/health; GET http://127.0.0.1:3080/api/runtime/identity; GET http://127.0.0.1:5173/`: 通过：桌面 dev 用隐藏 cmd 启动，Vite 5173 返回 200，Rust 后端 3080 /api/health 返回 available=true，/api/runtime/identity 返回 {app:codem,backend:rust}；启动日志 %TEMP%\\codem-desktop-dev-20260706-155748.log。
- 2026-07-06T07:54:37.294Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：补 done 退出语义后 fmt、两个 Rust bin cargo check、前端 typecheck 均成功；git diff --check 仅 Windows LF/CRLF 提示。

- 2026-07-06T07:45:53.838Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo test --manifest-path src-tauri\\Cargo.toml validate_desktop_file_path; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：fmt、codem-backend/codem cargo check、validate_desktop_file_path 库测试、前端 typecheck 均成功；git diff --check 仅 Windows LF/CRLF 提示。
- 2026-07-06T07:36:29.296Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; cargo test --manifest-path src-tauri\\Cargo.toml --bin codem has_success_status; cargo build --manifest-path src-tauri\\Cargo.toml --bin codem-backend; npm run typecheck; git diff --check; 3093 real /api/runtime/identity probe`: 通过：fmt、codem-backend/codem cargo check、has_success_status 单测、codem-backend build、前端 typecheck 均成功；git diff --check 仅 Windows LF/CRLF 提示。3093 临时后端 /api/runtime/identity 返回 {app:codem, backend:rust}，/api/health 200，evil Origin 无 ACAO；临时 3093 后端 PID 2876 已停止。

- 2026-07-06T07:18:57.436Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; 3092 real API probes for CORS/file-preview/Skill install`: 通过：fmt、两个 Rust bin cargo check、前端 typecheck 均成功；git diff --check 仅 Windows LF/CRLF 提示。真实 3092 探针：evil Origin 不返回 ACAO，本地 127.0.0.1:5173 与 tauri://localhost 正常反射；README file-preview 200；D:\\ai_proj\\codem\\..\\codem-outside-preview-secret.txt 返回 403 无权访问；Skill name '..' 返回 400 非法 Skill 名称，正常 codem-test-skill 可安装到临时 project scope；临时 3092 后端 PID 43188 已停止。
- 2026-07-05T10:55:49.295Z `real /api/claude/run human-input parity on 3090 vs 3081 and restarted 3080`: 通过：同一 AskUserQuestion/RequestUserInput prompt 下，原版 3090 提问后 visibleAfter=[]；新 Rust 3081 提问后 visibleAfter=[]，无额外 approval-request；重启后的桌面 3080 复测 request-user-input 后仅 trace/raw/assistant-snapshot，visibleAfter=[]。Plan ExitPlanMode 审批对照：3090 与 3081 均为 approval-request 后保留 tool-stop，行为一致。

- 2026-07-05T10:55:35.740Z `cargo fmt --manifest-path src-tauri\\Cargo.toml --check; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check`: 通过：fmt/check/typecheck 均成功；git diff --check 仅提示 src-tauri/src/backend.rs 工作区 LF 将被 Git 转 CRLF，无空白错误。
- 2026-07-05T05:51:42.426Z `real /api/claude/run parity on 3090 vs 3081`: 真实 Claude 最小消息两端均成功完成，事件流包含 done 和 usage 且无 error；events replay 两端均过滤 raw/trace/assistant-snapshot/claude-event。

- 2026-07-05T05:49:28.828Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; 3090 vs 3081 API parity harness`: Rust 后端和桌面 bin 检查通过；前端 typecheck 通过；git diff --check 仅 Windows LF/CRLF 提示；全接口原版对照首轮 93 项剩 13 项，修复后定向复测全部通过；顺序重试广覆盖 78 项剩 2 项，修复 guide/interrupt 后两项定向通过。
- 2026-07-05T04:49:35.638Z `Git 写操作与 Claude NDJSON 真实对照`: 通过：原版 3090 与 Rust 3081 对照 add-files、commit 空 files/正常 commit、branch、switch、branch/delete、worktree create、push-preview 错误体、usage invalid 错误体均对齐；Claude 最小 run content-type、phase、done、usage、replay 过滤、active=false 对齐；审批探针未触发 approval-request，两端均完成无错误，工具事件还需后续用稳定 fixture 或强制场景继续验证。

- 2026-07-05T04:18:40.661Z `cargo check --manifest-path src-tauri\\Cargo.toml --bin codem-backend; cargo check --manifest-path src-tauri\\Cargo.toml --bin codem; npm run typecheck; git diff --check; desktop health`: 通过：两个 Rust bin 编译检查成功，前端 typecheck 成功，git diff --check 无 whitespace 错误；重启桌面 dev 后 /api/health available=true，5173 返回 HTTP 200。
- 2026-07-05T04:18:40.655Z `原版 3090 与 Rust 3091 真实接口对照`: 通过：/api/usage all/range/project/invalid 与原版关键统计一致；settings PUT、system-prompt GET/PUT、MCP servers/configs、plugin installed/marketplaces/skills/command、slash commands、attachments image/image-from-path、file/image preview、project/thread CRUD 均与原版结构和关键字段对齐。

## Completed
