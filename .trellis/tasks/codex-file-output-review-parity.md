# Task: Codex 文件产物与审查能力对齐

## Background

CodeM 已经为 Claude Code 的 `Write`、`Edit`、`NotebookEdit` 工具实现输出文档列表、
变更摘要、逐文件 Diff、右侧工作台审查和默认应用打开能力。Codex App Server 也会发出
结构化 `fileChange` item，但当前桥接只把整个 `changes[]` 放入一个名为 `Edit` 的工具，
前端仍只读取 Claude 的 `file_path/path/notebook_path`，导致 Codex 会话看不到上述卡片。

同时，聊天 Markdown 的相对文件链接没有点击拦截。点击 `prd.md` 等链接会触发 WebView
相对导航，表现为 CodeM 主界面重新加载或跳离应用页面。

## Objective

让 Codex 会话复用现有输出文档、变更摘要和右侧审查体验，并阻止本地 Markdown 链接触发主界面重载

## Scope

In scope:

- 消费 Codex `item/fileChange/patchUpdated`，保留逐文件 `path`、`diff` 和
  `add/update/delete/move` 语义。
- 将一条 Codex fileChange item 拆成现有前端可复用的逐文件 `Edit/Write` 工具数据，
  让输出文档列表、变更摘要和右侧 Diff 审查无需新增第二套 UI。
- 对未收到 patchUpdated 的兼容路径，从 `item/started|completed` 的 `changes[]` 提取文件路径，
  至少保留文件列表和文档卡片。
- Windows Codex 将 `apply_patch` 上报为成功的 `commandExecution` 且没有 fileChange 时，
  仅解析工具命令中的完整 `*** Begin Patch ... *** End Patch` 结构，并把文件变化补入工具结果；
  失败命令、普通 Bash、assistant 自然语言和 Git 工作区差异都不得触发该兜底。
- 将聊天 Markdown 链接分类为外部网址、页内锚点、本地工作区文件和不支持协议；
  本地文件在右侧工作台打开，不能触发主 WebView 导航。
- 输出文件卡片的预览、默认应用打开、文件浏览器定位和复制路径统一基于当前 turn workspace
  解析相对路径，不能回落到 Rust backend 的进程工作目录。
- Windows 默认应用打开使用原生 Unicode Shell API；打开失败时返回稳定中文错误，不能把
  PowerShell 本地代码页输出按 UTF-8 解码成乱码。
- 实时事件与 CodeM SQLite 历史使用同一 `ToolStep` 结构，刷新后仍能恢复文件卡片。
- 为大 Diff 使用现有事件字符串上限和前端延迟渲染能力，不保存原始 Codex JSON-RPC。

Out of scope:

- 不接入 Codex `review/start` 独立审查 Agent、线程 fork/archive 或用量页面。
- 不重做右侧工作台、变更卡片或输出文档卡片的视觉设计。
- 不通过 Git 全仓扫描猜测单轮改动，也不解析 assistant 自然语言提取文件名。
- 不改变 Claude Code、Grok、OpenCode、Pi 的事件协议和现有交互。
- 不允许 `javascript:`、`data:` 等非受支持协议作为文件链接执行。

## Impact

- Backend：`src-tauri/src/codex_app_server.rs` 解析 Codex patch 通知；
  对 Windows commandExecution/apply_patch 兼容路径解析完整结构化补丁；
  `src-tauri/src/agent_run.rs` 将逐文件变化映射到通用运行事件。
- Frontend：文件产物 helper 兼容统一文件变更输入；Markdown link renderer 接收本地文件动作；
  `ConversationTurn` 把会话工作目录和工作台预览动作传入链接 renderer。
- Persistence：不新增表或字段，继续持久化既有 `ToolStep`；只保存边界化后的工具输入和结果。
- Compatibility：外部 HTTP(S) 仍交给系统浏览器，页内锚点保持浏览器锚点行为。
- Performance：逐文件工具数量与 Codex changes 数量一致；Diff 使用已有折叠、延迟渲染和大小边界。
- Security：本地路径通过现有工作区文件预览 API 读取；不执行链接，不记录原始协议事件。

## Acceptance Criteria

- [x] Codex `patchUpdated` 的 add/update/delete/move 文件都能生成稳定的逐文件工具事件。
- [x] Codex 生成 Markdown、TXT、JSON、CSV、YAML、HTML 文档后，回答下方显示输出文件卡片。
- [x] Codex 修改代码后，回答下方显示变更摘要；单文件和“审查全部”能在右侧打开 Diff。
- [x] 点击 assistant Markdown 中的相对或绝对工作区文件链接会打开右侧预览，不改变页面 URL。
- [x] HTTP(S) 链接仍使用系统浏览器，`#anchor` 保持页内导航，不支持协议不会执行。
- [x] 实时 Codex turn 与刷新后的 CodeM 历史都保留文件卡片及审查数据。
- [x] Claude Code 原有输出文件、变更摘要、撤销和右侧预览测试保持通过。
- [x] 大文件、长 Diff 不在主对话中默认全量展开，不引入重复工作区请求。
- [x] 相对输出文件的打开、定位和复制路径均指向 turn workspace 下的真实文件。
- [x] Windows 默认应用打开不再经过 PowerShell，失败信息不包含乱码。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml codex`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `node --import tsx --test src/lib/conversation-output-files.test.ts src/lib/conversation-changed-files.test.ts src/lib/markdown-link.test.ts`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test src/lib/conversation-output-file-interactions.test.ts src/lib/conversation.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml windows_shell_execute_error_message`
- 桌面开发模式真实 Codex 会话：生成 Markdown 文档、修改代码、打开单文件 Diff、审查全部、点击文档链接。

## Implementation Record

- 2026-08-01T08:05:59.739Z 定位并修复输出文件打开链路：相对产物路径统一按 turn workspace 解析后用于预览、默认应用打开、资源管理器定位和复制；Windows 默认应用打开改用 ShellExecuteW，避免 PowerShell 本地代码页乱码，并为常见错误码提供稳定中文提示。TDD RED/GREEN 已确认。
- 2026-08-01T05:11:15.426Z 修复 Codex 新增文件统计：统一 Diff 解析直接保留原始增删行计数，避免空文件被误算为 1 行删除；真实验收发现历史 turn 缺少 workspace，Markdown 本地链接现回退 activeProject.path，并在两者都缺失时保留原始路径防止崩溃。

- 2026-08-01T04:39:28.204Z 真实 Windows Codex 0.146.0 验收确认：成功 apply_patch 仍作为 commandExecution/Bash 上报，且该轮没有 fileChange 或 turn/diff/updated。兜底只解析成功工具输入中的完整 Begin Patch/End Patch 结构，不解析 assistant 自然语言、不扫描 Git 猜测变更。
- 2026-08-01T03:25:37.938Z 已确认采用通用文件产物模型：Codex patchUpdated 归一化为既有逐文件工具事件，复用输出文档和变更审查 UI；本轮不接 review/start，不扫描 Git 猜测单轮改动。

- 2026-08-01T03:24:28.517Z Task created by Trellis automation.

## Verification Results

- 2026-08-01T08:08:36.369Z `桌面后端真实默认应用打开与失败错误`: 真实 deliverable.md 存在且 POST /api/system/open-path 返回 200 ok=true；不存在的中文路径返回 400 和可读中文错误码 2；Web 5173=200，backend health 正常
- 2026-08-01T08:08:25.495Z `npm run typecheck && npm run build && cargo fmt --check`: 全部通过；Vite 仅有既有 chunk size 和 dynamic import 提示

- 2026-08-01T08:08:17.994Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust 240 passed, 0 failed, 1 ignored；桌面壳 13 passed；包含 ShellExecuteW 可读错误映射测试
- 2026-08-01T08:08:07.833Z `node --import tsx --test 产物与审查相关前端测试`: 57 passed, 0 failed；包含相对产物路径按 turn workspace 解析及组件动作接线回归

- 2026-08-01T05:13:06.209Z `all frontend node tests`: 640 条中 638 通过；2 条失败已确认在 HEAD 上同样存在，分别是 macos-private-api Cargo 配置断言和 UserContentBlocks 旧单行 JSX 正则，不属于本任务回归。
- 2026-08-01T05:13:05.396Z `Playwright codem-parity real Codex smoke`: 真实 Codex 会话显示输出文档、两文件变更摘要、deliverable.md +3/-0、单文件 Diff 与审查全部；相对链接在右侧打开，URL 不变；刷新后历史恢复卡片和审查数据。

- 2026-08-01T05:13:04.540Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: Rust 格式与 Git 差异检查通过。
- 2026-08-01T05:13:03.760Z `npm run typecheck && npm run build`: 类型检查与 Vite 生产构建通过；仅有既有 chunk/dynamic import 警告。

- 2026-08-01T05:13:02.916Z `node --import tsx --test src/components/ConversationStreaming.render-perf.test.ts src/lib/conversation.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-changed-files.test.ts src/lib/markdown-link.test.ts src/lib/macos-webkit-compositing.test.ts`: 本任务相关前端测试 54/54 通过。
- 2026-08-01T05:13:02.116Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust 全量通过：230 passed，1 ignored；另有集成目标 13 passed。

## Completion Summary

- 2026-08-01T08:09:29.028Z 修复产物卡片默认应用打开：相对路径统一按 turn workspace 解析并用于预览、打开、定位和复制；Windows 改用 ShellExecuteW 原生 Unicode 打开，失败返回可读中文错误。前端相关 57 tests、Rust 240 tests + 桌面壳 13 tests、typecheck、build、fmt、真实 open-path 成功/失败验证均通过。
- 2026-08-01T05:13:20.060Z 完成 Codex 文件产物与审查能力对齐：官方 fileChange 与 Windows apply_patch 兼容路径统一生成逐文件变化；输出文档、变更摘要、单文件和批量审查、Markdown 本地链接右侧预览及历史恢复已完成。修正新增文件 +3/-1 误计为 +3/-0，并补齐历史 turn 缺 workspace 的项目路径回退。

## Follow-ups

- Codex `review/start` 独立审查 Agent 和 review target 选择另行讨论，不纳入本任务。
- 完整前端套件当前有两条与本任务无关的基线失败：`desktop-packaging.test.ts` 要求
  `macos-private-api` feature，但 `HEAD` 的 `src-tauri/Cargo.toml` 未配置；
  `queued-prompts.test.ts` 的单行 JSX 正则与 `HEAD` 中现有多行 `UserContentBlocks` 不匹配。
