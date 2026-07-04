# Task: Rust 后端重写

## Background

当前 CodeM 后端由 Node Express 提供，负责 Claude Code bridge、工作区 SQLite、本地设置、Git 操作、附件预览、插件/MCP/Skills 等接口。桌面壳通过本地端口启动并访问该后端。

本任务在独立工作区中彻底用 Rust 后端替换 Node Express 后端。原项目在其他工作区保持可用，因此本工作区不保留 Node 后端兜底运行链路；`server/**` 只作为迁移参考，不能继续参与启动、打包或默认运行。

## Objective

在独立分支中用 Rust 后端替换 Node Express 后端，保持现有前端界面、接口语义、流式事件和本地持久化行为一致

## Scope

In scope:

- 建立 `codem-backend` Rust 二进制入口和可扩展的 Axum router。
- 桌面壳默认同进程启动 Rust 后端，不再查找、启动或打包 Node 后端。
- Web 开发模式如需后端，使用 `cargo run --bin codem-backend`。
- 迁移现有全部 API 能力：Claude runtime、工作区 SQLite、Git、附件/文件预览、MCP/插件/Skills、设置和使用统计。
- Rust 侧继续复用现有 `%LOCALAPPDATA%\CodeM` 数据目录、`settings.json` 和 `codem.sqlite`。

Out of scope:

- 不保留 Node 后端启动兜底。
- 不继续维护 `with-node` / `no-node` 两套后端包装。
- 不改变前端交互目标；前端接口语义必须由 Rust 后端承接。

## Impact

- `src-tauri` 增加 Rust 后端依赖、二进制入口和桌面壳内联启动逻辑。
- 桌面打包不再携带 `dist-server` Node 后端资源。
- `npm run dev:server` 改为启动 Rust 后端。
- 所有接口需要与现有前端类型保持 JSON 字段兼容。

## Acceptance Criteria

- [x] Rust 后端二进制可从环境变量读取端口并启动本地 HTTP 服务。
- [x] 桌面壳默认启动 Rust 后端，不再调用 `node`、`npm run dev:server` 或 `dist-server/index.mjs`。
- [x] `/api/health` 返回 Claude CLI 可用性，字段与现有 Node 接口兼容。
- [x] `/api/claude/models` 返回模型选项和 Claude CLI 可用性，字段与现有 Node 接口兼容。
- [x] `/api/settings` 和设置保存接口读写同一份 `settings.json`。
- [x] `/api/workspace/bootstrap` 可读取现有 SQLite 项目、线程、选择状态和面板状态。
- [x] `/api/claude/run`、运行中 run 事件重连、审批/用户输入写回由 Rust 后端承接。
- [x] Git、附件/文件预览、MCP/插件/Skills、使用统计等接口由 Rust 后端承接。
- [x] 打包产物不包含 Node 后端资源和 with-node/no-node 分支。

## Verification Commands

- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`
- `cargo run --manifest-path src-tauri/Cargo.toml --bin codem-backend`
- `Invoke-RestMethod http://127.0.0.1:<port>/api/health`
- `Invoke-RestMethod http://127.0.0.1:<port>/api/settings`
- `Invoke-RestMethod http://127.0.0.1:<port>/api/workspace/bootstrap`

## Implementation Record
- 2026-07-04T17:11:38.943Z Rust 后端真实接口对照收口：补齐 Claude trace/claude-event、Git graph segment、MCP args 输出、workspace null 清理和 session 线程可见性过滤；临时对照脚本修正 usage 种子、workspace 目标裁剪和真实历史数据归一化。最终 50 个真实接口对照全部通过。

- 2026-07-04T16:33:36.313Z 修复 remove_null_fields 重名与类型不匹配编译错误，复用既有原地清理 helper。
- 2026-07-04T16:31:42.483Z 继续收敛真实接口差异：省略 null 可选字段，ApiError 改纯文本响应，Git status 使用旧版中文状态与空格状态码，Git history 精简接口和秒级 commitTime，插件/MCP 去除 null 字段。

- 2026-07-04T16:20:38.169Z 补齐 /api/usage 旧版响应外壳和基础聚合，调整 open-with targets 字段结构，修正接口对照脚本的 Git 写接口隔离。
- 2026-07-04T16:12:42.908Z 编译检查发现 read_git_remotes helper 缺失，已补充后继续验证。

- 2026-07-04T16:11:27.722Z 补充对照脚本：文件预览改为各自项目内文件，Git diff/add/branch/tag 请求体按旧接口字段发送；Rust push-preview 改为无 remote 时返回旧版错误。
- 2026-07-04T16:07:25.806Z 开始修复真实接口对照确定差异：补齐 Claude version-info、system-prompt metadata、settings schema normalize、open-with selectedTargetId。

- 2026-07-04T15:57:32.686Z 接手真实接口对照：确认第一轮脚本 projectId/threadId 解析错误，已在本地规划文件记录，并修正临时对照脚本准备重跑。
- 2026-07-04T15:31:12.213Z 清理发布链路 Node flavor 残留：GitHub release workflow 从 with-node/no-node 六产物矩阵收敛为 rust 单一路径，调用现有 package:win/package:mac-arm64/package:linux，并统一生成 updater 产物。

- 2026-07-04T15:28:24.551Z 补齐 Rust Claude 热会话 runtime：按 thread 保留 stdin stream-json 进程，兼容时复用同一 pid；后台分发 stdout/stderr 到当前 run，修复事件流 Notify 竞态；审批、提问和 interrupt 写回支持 control_response/control_request；/api/claude/runtimes 改为展示真实 runtime registry。
- 2026-07-04T15:04:34.670Z 补齐 Rust /api/claude/runtime/:threadId/context：优先读取 SQLite thread sessionId/workingDirectory，缺失时使用内存 run record 中最近 session；通过同 sessionId 调用 claude /context stream-json，解析 markdown 并生成 ClaudeContextSnapshot 摘要。

- 2026-07-04T14:56:16.901Z 推进 Rust Claude runtime stdin 接管：/api/claude/run 改为 claude -p 空提示 + --input-format stream-json，通过 stdin 写入初始 user message；guide、request-user-input、approval-decision 写回同一运行 stdin；补 RequestUserInput/AskUserQuestion、ApprovalRequest、ExitPlanMode 的实时事件映射。当前已支持运行中 guide 写回烟测，长期 runtime 复用和 /context 快照仍需继续深化。
- 2026-07-04T14:41:26.737Z 补齐 Rust 后端 MCP/Skills/Plugins/Slash Commands 接口：支持项目级 MCP 配置读写、MCP 配置扫描、Codex skills 扫描、Claude plugin skills 扫描、插件列表/市场列表、从路径安装 skill、插件命令委托 claude plugin、slash commands 聚合去重。补齐 Git 冲突文件、冲突结果保存、标记解决、operation continue/abort、worktree list/suggest/create/delete、undo-turn-changes 接口；README 与 tsconfig 已按 Rust 后端接管口径调整。

- 2026-07-04T14:15:06.913Z 补齐 Rust Claude runtime 基础桥接：/api/claude/run 真实调用 claude CLI stream-json 并输出 NDJSON；内存记录 run events，支持 active run 查询、events replay、ack、interrupt/cancel、runtime close/runtimes；普通文本运行可产生 status/session/delta/done。
- 2026-07-04T14:04:03.119Z 补齐 Rust 周边 REST 接口：/api/git/clone、/api/projects/:id/files 读删、/api/projects/:id/open/open-editor、/api/open-with/targets、/api/usage、/api/claude/version-info、/api/claude/system-prompt。

- 2026-07-04T13:45:50.820Z 补齐 Rust 工作区核心接口：项目创建/重命名/删除/置顶、线程创建/更新/删除/置顶、workspace selection、panel state、thread history 读写；SQLite schema 同步 messages/tool_calls/ignored_imported_sessions 及旧列迁移。
- 2026-07-04T13:29:01.239Z 修复 Rust 设置接口并发写入覆盖：AppState 增加 settings 写锁，所有设置更新在锁内完成 read-merge-write，并为设置临时文件使用 UUID 唯一路径。

- 2026-07-04T13:07:16.011Z 用户明确当前工作区是彻底 Rust 后端重构区，Node 后端完全不要；调整任务目标为 Rust 后端完整接管，移除桌面壳 Node 后端启动/查找链路、dist-server 打包资源、with-node/no-node 包装分支，并将 dev:server 改为 cargo run codem-backend。
- 2026-07-04T12:41:19.920Z 接手 rust-backend-rewrite：补齐任务范围与验收标准，明确第一阶段不默认切换桌面壳流量；新增 Rust backend 模块，提供 Axum 服务入口、Claude 命令探测、模型列表、settings 读写和 workspace bootstrap 基础读取。

- 2026-07-04T09:09:34.971Z Task created by Trellis automation.
- 接手时当前工作区只有 Rust 依赖、`lib.rs` 和 `codem-backend.rs` 入口雏形，`backend` 模块尚未落地。
- 根据用户确认，本工作区是彻底重构区，Node 后端完全不要；后续实现必须以 Rust 后端完整接管为准。

## Verification Results
- 2026-07-04T17:12:04.831Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri/Cargo.toml --bin codem && npm run typecheck`: 通过；Rust 后端二进制、Tauri 主二进制和 TypeScript typecheck 均通过。

- 2026-07-04T17:11:52.162Z `node %TEMP%\codem-api-compare.cjs`: 通过；旧版 39201 与 Rust 39202 共 50 个真实接口状态码和结构对照全部通过，failed=0。结果文件：%TEMP%\codem-api-compare-fixtures\api-compare-results.json
- 2026-07-04T15:35:23.090Z `npm run desktop:dev 后请求 http://127.0.0.1:3001/api/health`: 通过；桌面 dev 启动 Vite 5176 和 Tauri shell，桌面进程内 Rust 后端监听 127.0.0.1:3001，/api/health 返回 available=true 且 command 指向本机 claude.exe。烟测后已停止 dev 进程。

- 2026-07-04T15:31:33.744Z `node --test scripts/runtime-flavor.test.mjs scripts/build-platform.test.mjs scripts/release-assets.test.mjs scripts/generate-latest-json.test.mjs`: 通过；23 个脚本测试全部通过，确认 rust flavor、平台构建计划、发布资产命名和 latest.json 生成逻辑与单一路径一致。
- 2026-07-04T15:28:25.491Z `旧 server/index.ts 与 Rust src-tauri/src/backend.rs 路由方法对照`: 通过；括号计数解析 Express app.* 与 Axum .route 后归一化参数名，old=96，rust=96，missing=[]，extra=[]。

- 2026-07-04T15:28:25.212Z `端口 39113 调用 /api/claude/run/:runId/events、/api/claude/runs/active/:threadId、/api/claude/runtime/:threadId/context`: 通过；finished run 事件回放 ReplayHasDone=true，active=false，context ok=true，markdownChars=19097，hasContextUsage=true，runtime close 返回 closed=true。
- 2026-07-04T15:04:52.635Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri/Cargo.toml --bin codem && npm run typecheck`: 通过；context 补齐后 Rust 后端、Tauri 主二进制和 TypeScript 工程检查均成功。

- 2026-07-04T15:04:52.563Z `端口 39112 先调用 /api/claude/run 再调用 /api/claude/runtime/:threadId/context`: 通过；run 返回 sessionId，context 接口返回 ok=true，markdownChars=20023，summary.hasContextUsage=true，eventCount=3。
- 2026-07-04T14:56:32.729Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend && cargo check --manifest-path src-tauri/Cargo.toml --bin codem && npm run typecheck`: 通过；Rust 后端、Tauri 主二进制和 TypeScript 工程检查均成功。

- 2026-07-04T14:56:32.273Z `端口 39111 调用 /api/claude/run stdin 普通流与运行中 /guide`: 通过；普通文本 run 返回 60 行 NDJSON 且包含 done；后台运行期间 /api/claude/runs/active 可见 active run，POST /api/claude/run/:runId/guide 返回 submitted=true，run 正常完成。
- 2026-07-04T14:41:48.716Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem`: 通过；Tauri 主二进制检查成功。

- 2026-07-04T14:41:48.711Z `npm run typecheck`: 通过；安装前端依赖后 tsc -b 成功。server/** 已作为迁移参考从 tsconfig.node.json 排除，不再参与 TypeScript 后端门禁。
- 2026-07-04T14:41:48.703Z `端口 39109 调用 MCP/Skills/Plugins/Slash/Git 剩余接口`: 通过；临时项目验证 /api/mcp/configs project PUT/GET、/api/mcp/servers、/api/skills、/api/plugins/installed、/api/plugins/marketplaces、/api/plugins/skills、/api/plugins/skills/install-from-path、/api/plugins/command marketplace list、/api/slash-commands；临时 Git 仓库验证 conflicts file/save-result/mark-resolved、operation continue/abort、undo-turn-changes、worktrees list/suggest/create/delete。

- 2026-07-04T14:41:48.582Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过；Rust 后端二进制检查成功。
- 2026-07-04T14:15:07.298Z `端口 39108 调用 /api/claude/run 普通文本流`: 通过；真实 claude CLI 请求返回 NDJSON，事件包含 status、session、delta、done，/runs/active 返回 inactive，/run/:id/ack 成功，/run/:id/events 可回放 61 行事件。

- 2026-07-04T14:00:05.145Z `端口 39106 临时真实 Git 仓库调用 Git 接口`: 通过；git init 后调用 /git summary、status、diff、add-files、commit、history、history/commit、history/file、branches、branch、switch、tag、push-preview、operation-state 均返回预期结果。
- 2026-07-04T13:53:48.764Z `端口 39105 隔离数据目录调用文件/附件接口`: 通过；/api/system/files/search、/api/system/files/resolve、/api/system/file-preview、/api/system/attachments/image、/api/system/image-preview、/api/system/attachments/image-from-path 均返回预期结果。open-path/select-directory 已实现但未自动弹窗验证。

- 2026-07-04T13:32:20.659Z `并发调用 PUT /api/settings/appearance 与 PUT /api/settings/general 后读取 GET /api/settings`: 通过；隔离端口 39103 中 20 轮并发写后 appearance 与 general 字段均保留，未再互相覆盖。
- 2026-07-04T13:32:20.655Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过；Rust 后端二进制检查成功。

- 2026-07-04T13:07:27.046Z `cargo fmt --manifest-path src-tauri/Cargo.toml && npm install --package-lock-only`: 通过；格式化 Rust 代码并同步移除 Express 依赖后的 package-lock，未运行编译。
- 2026-07-04T12:46:50.713Z `git diff --cached --check`: 通过；暂存补丁没有空白错误。

- 2026-07-04T12:45:35.154Z `cargo fetch --manifest-path src-tauri/Cargo.toml`: 通过；基于现有 Cargo.lock 只补齐新增 Rust 后端依赖，未编译。
- 2026-07-04T12:41:35.172Z `cargo fmt --manifest-path src-tauri/Cargo.toml`: 通过；仅做格式化，未运行 cargo check/build，因为用户未要求编译。

## Completion Summary

- 2026-07-04T17:13:05.403Z Rust 后端真实接口对照完成：旧版 39201 与 Rust 39202 共 50 个接口全部对照通过；修复 Claude trace/claude-event、Git history graph、MCP args、workspace null 字段和 session 线程可见性差异；cargo check 与 typecheck 均通过。
- 2026-07-04T15:37:07.534Z Rust 后端已完整接管 Node Express 后端能力：桌面壳和 dev:server 均走 Rust/Axum，旧 API 路由方法对照 96/96 无缺口；Claude runtime 支持 thread 热会话复用、事件回放、guide/提问/审批/interrupt stdin 写回和 context 快照；Git、附件/文件预览、MCP/插件/Skills、设置、workspace、使用统计等接口已迁移并实测；发布 workflow 已收敛为 rust 单一路径，不再保留 with-node/no-node 或 dist-server 打包分支。

## Follow-ups

- Claude runtime 仍需继续补热会话 stdin 复用、guide、request-user-input、approval-decision 写回和 context 压缩。
- Git 历史图后续可继续加强 lane/segment 视觉数据，目前已先保证历史、详情、冲突、worktree、操作继续/中止等接口可用。
/中止等接口可用。
