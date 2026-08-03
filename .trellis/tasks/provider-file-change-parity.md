# Task: 多 Provider 文件产出与 Diff 闭环

## Background

CodeM 已为 Claude Code 和 OpenAI Codex 提供文件产出卡片、修改文件摘要、单文件 Diff 和
“审查全部”本地 Diff。Claude 主要从 Edit/Write 工具输入重建文件变化；Codex 后端把
Provider 事件归一为 `tool-result.content` 中的 `changes[]`。Grok Build 与 OpenCode 通过
ACP 接入，Pi 通过原生 RPC 接入，当前虽然能显示工具调用，但文件变化信息在协议适配或前端
启发式解析阶段丢失，导致上述闭环不可用。

本任务采用主 Agent 设计、CC 执行指定切片、主 Agent 独立复核的协作方式。Provider 原始协议
只允许在 Rust 适配层解释，不能把 ACP/Pi 字段名继续扩散到前端。

## Objective

让 Grok、OpenCode 和 Pi 复用现有文件卡片、修改摘要、单文件 Diff 与审查全部能力

## Scope

In scope:

- Grok Build、OpenCode 的 ACP `tool_call/tool_call_update` 文件变化归一化。
- Pi `tool_execution_start/tool_execution_end` 文件变化归一化。
- 复用现有 `ToolResult.content` JSON 字符串中的 `changes[]` 内部契约，不新增 wire event 类型、
  `ToolStep` 字段或 SQLite 列。
- 文件产出卡片、修改文件摘要、单文件 Diff、“审查全部”本地 Diff 和刷新后历史恢复。
- 创建、修改、删除和移动/重命名的兼容处理；没有充分证据时不得伪造精确 Diff。
- 失败工具、敏感内容、大输入/大 Diff、重复/乱序工具事件的安全与性能边界。
- Claude Code、Codex 既有行为回归验证。

Out of scope:

- Provider 原生 review/review-start 能力。
- 扫描整个 Git 工作区推断 Agent 改了什么，或解析 assistant 自然语言猜测文件变化。
- ACP/Pi sidechain/subtool 树重构。
- 新增数据库迁移或持久化 Provider 原始事件。
- PDF/DOCX 等文档正文解析器，以及完整文件编辑器。
- 对无法从结构化事件确认的文件变化生成虚假卡片或虚假 Diff。

## Impact

- Backend: `src-tauri/src/acp.rs`、`src-tauri/src/agent_run.rs`，必要时补充 Provider 事件 fixture。
- Frontend: `src/lib/conversation-preview-shortcuts.ts`、`src/lib/conversation-changed-files.ts` 及测试。
- Persistence: 沿用 `tool_calls.name/input_text/result_text/is_error`，不改 schema。
- Rendering: 沿用 `turn.items`/`turn.tools`，实时事件和 SQLite 历史必须得到同一结果。

## Chosen Design

### Internal contract

文件变化统一编码到成功 `tool-result.content` 的 JSON：

```json
{
  "status": "completed",
  "changes": [
    {
      "path": "src/app.ts",
      "kind": { "type": "update", "move_path": null },
      "diff": "@@ ..."
    }
  ]
}
```

- `path` 是源路径；移动时 `kind.move_path` 是目标路径。
- `kind.type` 只使用 `add/update/delete/move`；前端继续把 move 作为目标路径上的 update 展示，
  同时保留源/目标信息用于后续增强。
- `diff` 只在 Provider 提供 patch/diff，或工具参数明确提供 old/new 文本时生成。
- `Write` 只有新内容、无法确认旧内容时可以生成新增内容预览，但不得声称它是完整旧文件对比。
- `is_error=true`、ACP `status=failed` 或 Pi ToolEnd 失败时，结果不得包含 `changes[]`。
- 结果字符串继续经过既有脱敏、深度、数组、字段和字符串大小限制。

### Provider adapters

- ACP: 解析并保留 `kind/rawInput/content[type=diff]`；按 `toolCallId` 合并首次调用和后续更新。
  首次事件照常发 ToolStart，迟到的 rawInput/diff 只更新 mapper 内部状态，成功完成时统一生成
  ToolResult changes。ACP v1 官方协议明确 diff 内容为 `path/oldText/newText`（新文件 oldText 可为
  null），因此优先按该公开结构生成统一 diff；标题继续用于展示，不再作为文件类型的唯一判断依据。
- Pi: ToolStart 时保存 `tool_name/args`，并继续发原 ToolStart；ToolEnd 时只在成功情况下从保存的
  `path/file_path`、`edits[{oldText,newText}]`（兼容旧单组 `oldText/newText`）、`content`、
  `diff/patch` 生成 changes。ToolEnd 的原始结果摘要仍保留，孤立 ToolEnd 不生成文件变化。
- Claude/Codex: 不改变事件生产方式；前端仍保留 Claude input fallback 和 Codex result changes 优先级。

### Frontend consumption

- `collectToolConversationFileChanges` 先拒绝 `status=error` 或 `isError=true`，再读取 result changes；
  仅为 Claude 兼容路径保留 input fallback。
- result changes 是 Provider 中立契约，不新增 Grok/OpenCode/Pi 分支，不识别小写工具名。
- 文件卡片、修改摘要、单文件 Diff 和审查全部继续共用同一根函数。
- 大 Diff 延续后端上限，前端预览和审查聚合增加有界行数/字符数，超限时明确截断而不是挂载
  大量 DOM。

### Persistence and recovery

- 实时 ToolResult 进入 `ToolStep.resultText`，保存到 `tool_calls.result_text`，刷新后原样恢复。
- 不保存 base64、密钥、完整 Provider raw event 或超限文件全文。
- `toolUseId` 继续作为工具开始/完成与历史恢复的稳定关联键。

### Compatibility and failure policy

- 不支持的 ACP 字段形态只保留普通工具展示，不生成文件变化。
- 重复 completed/failed 更新保持幂等，只生成一次 ToolResult/ToolStop。
- 失败工具不生成文件卡片、修改摘要、Diff 或撤销入口。
- 本任务不以真实 Provider 未登录作为“功能已线上验证”的依据；fixture 验证与真实 Provider
  验证分开记录。

## Acceptance Criteria

- [ ] Grok 系统渠道使用 `~/.grok/config.toml` 中已配置的 API Key 时，不因新版 ACP 缺少
      `cached_token` 而误报需要 `grok login`。
- [ ] Grok/OpenCode ACP 成功创建 Markdown 后出现输出文件卡片，可按现有设置预览/默认应用打开。
- [ ] Grok/OpenCode ACP 成功修改代码后出现修改摘要、单文件 Diff 和“审查全部”。
- [ ] Pi 成功创建 Markdown、修改代码时具备同等能力。
- [ ] 刷新会话后，上述卡片和 Diff 能从 SQLite 历史恢复，且不重复。
- [ ] 失败 Edit/Write 不生成任何文件产物或修改卡片。
- [ ] add/update/delete/move fixture 均有明确、稳定的展示结果。
- [ ] 大 Diff 被有界处理，不一次性渲染无上限内容。
- [ ] 敏感字段、base64 和超限正文不会进入 resultText/trace/history。
- [ ] Claude input fallback 与 Codex changes[] 既有测试保持通过。
- [ ] 不接入 Provider 原生审查，不扫描 Git 工作区，不解析自然语言。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml acp_mapper`
- `cargo test --manifest-path src-tauri/Cargo.toml pi_`
- `npx tsx --test src/lib/conversation-changed-files.test.ts src/lib/conversation-output-files.test.ts`
- `npm run typecheck`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- 桌面开发模式手工验证：文件卡片、单文件 Diff、审查全部、刷新恢复、默认应用打开。

## Implementation Record

- 2026-08-03T13:04:48.976Z 完成 Grok 重复文件变化修复：ACP mapper 持有运行工作区，剥离 Windows 扩展路径前缀并把工作区内绝对路径归一为相对路径后合并；空 oldText 按零行生成新增 Diff。前端输出卡片和修改摘要同样按会话工作区规范化，单工具内优先项目相对证据合并，兼容既有 SQLite 重复历史。
- 2026-08-03T12:54:25.282Z 实测发现 Grok 同一 write 同时返回 Windows 扩展绝对路径与项目相对路径，导致输出卡片和修改摘要重复；修复采用后端按运行工作区规范化并合并 evidence、空旧文本按零行处理，前端按工作区去重作为既有 SQLite 历史兼容层。

- 2026-08-03T12:44:37.860Z Grok 系统渠道实测修复：本机 Grok 从 0.2.112 更新到 0.2.118 后 ACP 仅暴露 xai.api_key/grok.com，不再暴露 cached_token；系统配置已在 ~/.grok/config.toml 提供模型 API Key。CodeM 现仅在旧版提供 cached_token 时执行旧认证，新版由 Grok 读取正常配置并通过 session/new 验证，不再误报必须 grok login。
- 2026-08-03T10:14:10.530Z OpenCode 1.18.10 实测确认：write 在 ACP 中使用宽泛 kind=edit，精确 title=write，正文可能在后续 rawInput 才到达。主 Agent据此仅对精确已知工具名采用更具体的 add/update/delete/move 操作提示，write+content 生成新增 Diff；同时文件汇总按会话 workspace 将 Windows 中文绝对路径归一为项目相对路径，并修正尾随换行导致的虚假空白新增行。

- 2026-08-03T09:50:49.205Z 主 Agent独立复核并修正后端与前端边界：update+content 不再伪造成全新增 Diff，delete content 按删除行展示；路径级无 Diff 变更保留在汇总但不开放虚假审查；ACP 累积 changes 限制 32 项；总结果单行超限保留明确截断标记；内嵌 JSON base64 脱敏且保留中文/原行结构；前端在标准化和拆行前即限制 4000 行/256KB。Pi 15 项、ACP 39 通过 1 ignored、前端 47 项及 typecheck 通过。
- 2026-08-03T09:14:43.618Z 主 Agent补齐前端大 Diff 性能边界：单卡解析与审查全部聚合限制为 4000 行/256KB并显示截断标记；45 项定向测试、typecheck、diff check 通过。

- 2026-08-03T08:46:57.065Z 主 Agent完成前端通用消费切片：错误工具统一过滤，changes[] 解析器 Provider 中立化并兼容 old/new/content；18/18 定向测试和 typecheck 通过。
- 2026-08-03T08:43:12.207Z 核对本机 Pi 0.83.0 类型：edit 使用 path + edits[{oldText,newText}]，write 使用 path + content；后端归一化必须支持多段 edit，并兼容旧单组字段。

- 2026-08-03T08:39:46.343Z 联网核对 ACP v1 官方 Tool Calls：content[type=diff] 标准字段为 path/oldText/newText，新文件 oldText 可为 null；实现和 fixture 以该结构为准。
- 2026-08-03T08:32:25.668Z 主 Agent完成正式设计：成功 ToolResult 统一 changes[]，ACP/Pi 在后端适配层归一化，失败工具不产出 changes，前端保持 Provider 中立，SQLite 不迁移。

- 2026-08-03T08:29:06.752Z Task created by Trellis automation.
- 2026-08-03 主 Agent完成现有 Claude/Codex/ACP/Pi 数据链复核，用户确认采用后端统一
  `changes[]`、前端 Provider 中立、SQLite 零迁移方案；CC 只执行明确编码切片。
- 2026-08-03 主 Agent联网核对 ACP v1 官方 Tool Calls 文档，确认 `content[type=diff]` 标准字段
  为 `path/oldText/newText`，并将其作为 ACP fixture 和归一化的权威输入结构。
- 2026-08-03 主 Agent核对本机 Pi 0.83.0 类型定义：edit 参数为
  `path + edits[{oldText,newText}]`，write 参数为 `path + content`；实现必须覆盖多段 edit，
  并只把旧单组字段作为向后兼容。

## Verification Results
- 2026-08-03T13:05:10.596Z `桌面开发版 codem.exe 自动重编译与 GET /api/health`: 新进程 2026-08-03 20:59:41 启动；http://127.0.0.1:3001/api/health 返回 available=true，前端 http://127.0.0.1:5173 正在监听。

- 2026-08-03T13:05:09.902Z `git diff --check`: 通过；仅有 Git 的 LF/CRLF 工作区提示。
- 2026-08-03T13:05:09.207Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。

- 2026-08-03T13:05:08.583Z `npm run build`: 通过；仅有既有 Vite chunk 提示。
- 2026-08-03T13:05:07.958Z `npm run typecheck`: 通过。

- 2026-08-03T13:05:07.287Z `npx tsx --test "src/**/*.test.ts"`: 725 passed；输出文件卡片、修改摘要、单文件 Diff、旧历史路径去重回归通过。
- 2026-08-03T13:05:06.638Z `cargo test --manifest-path src-tauri/Cargo.toml --lib acp_mapper`: 11 passed；新增扩展绝对路径与相对路径去重、中文路径和纯新增 Diff 回归通过。

- 2026-08-03T12:44:39.857Z `本机 CodeM Grok 系统渠道 POST /api/agents/grok/probe 与 GET /api/agents/grok-build/models?refresh=true`: Grok 0.2.118 initialized=true、authenticated=true、authError=null；模型 grok-4.5/贾维斯-0.15 正常返回。
- 2026-08-03T12:44:39.185Z `cargo test --manifest-path src-tauri/Cargo.toml --lib grok_`: 19 passed / 1 ignored；Grok 系统/自定义渠道、参数、日志脱敏和运行时相关回归通过。

- 2026-08-03T12:44:38.525Z `cargo test --manifest-path src-tauri/Cargo.toml --lib acp::tests::`: 26 passed / 1 ignored；新增新版 Grok 无 cached_token 兼容测试通过。
- 2026-08-03T10:18:10.376Z `桌面开发模式重启并请求 http://127.0.0.1:3001/api/health`: 新 codem.exe 已启动，健康接口返回 available=true；前端地址 http://127.0.0.1:5173。

- 2026-08-03T10:18:09.713Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 409 passed / 1 ignored / 1 failed；失败为未修改的 Claude 延迟复制真实进程测试 claude_delayed_fork_real_process_init_binds_before_exit，单独复跑仍失败；本任务 ACP/Pi 用例全部通过。
- 2026-08-03T10:18:09.073Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过；仅有 Git 的 LF/CRLF 工作区提示。

- 2026-08-03T10:18:08.398Z `npm run typecheck && npm run build`: 类型检查和生产构建通过；仅有既有 Vite chunk 提示。
- 2026-08-03T10:18:07.718Z `npx tsx --test "src/**/*.test.ts"`: 723 passed，含 Windows 中文绝对路径归一化与文件汇总/Diff 回归。

- 2026-08-03T10:18:07.046Z `cargo test --manifest-path src-tauri/Cargo.toml --lib pi_mapper`: 15 passed，Pi write/edit/delete、失败、重复事件和脱敏边界通过。
- 2026-08-03T10:18:06.328Z `cargo test --manifest-path src-tauri/Cargo.toml --lib acp_mapper`: 10 passed，覆盖 OpenCode 精确 write 标题、迟到正文、失败/重复事件、敏感信息和总量边界。

## Completion Summary
- 2026-08-03T13:18:51.909Z 完成 Grok、OpenCode 与 Pi 文件产出统一闭环：后端归一化成功工具 changes[]，前端复用文件卡片、修改摘要、单文件 Diff 和审查全部，兼容历史恢复、错误/敏感/大 Diff 边界；修复 Grok 新版系统渠道认证与 Windows 扩展绝对路径重复证据。ACP mapper 11 项、Pi mapper 15 项、前端 725 项、类型检查、构建、格式和 diff check 通过，桌面开发版健康。

## Follow-ups

- Provider 原生审查、ACP/Pi subtool 树和更完整的移动文件交互按独立任务评估。
