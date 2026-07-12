# Task: Codex 独立 CLI 真实联调

## Background

Codex App Server 首版已经完成协议 mock、Rust/前端回归和浏览器 smoke，但本机此前
只有 Windows Store 应用目录中的受保护 `codex.exe`，普通子进程启动会返回 Access
Denied，因此尚未验证真实账号、真实 app-server 事件和线程恢复。本任务安装官方独立
CLI，并只处理真实联调暴露的阻断问题。

## Objective

安装可由 CodeM 启动的官方 Codex CLI，并完成探测、文本流、停止与续聊的真实端到端验证；不读取或持久化认证凭据，不改 Claude/Grok 链路

## Scope

In scope:

- 通过本机 `7890` HTTP 代理安装官方 `@openai/codex` 独立 CLI。
- 验证 CLI 版本、登录状态和 `app-server` 可启动性，不读取或展示认证文件内容。
- 刷新 CodeM Provider Registry 探测；当前后端逐请求解析 CLI，安装后无需重启即可生效。
- 验证 Provider probe、新线程文本流、停止和刷新后的 `thread/resume`。
- 若真实协议与 mock 存在差异，只修复 Codex 驱动和通用 Agent 链路中的必要问题。

Out of scope:

- 不实现登录 UI，不保存 API key、OAuth token、Cookie 或原始 JSON-RPC。
- 不增加模型列表、reasoning effort、附件、历史导入、Review、MCP 或插件管理。
- 不修改 Claude 专用 API/Hook，也不改变 Grok ACP 行为。
- 不提交 npm 全局安装产物到仓库。

## Impact

- Environment：用户 npm 全局目录新增官方 Codex CLI。
- Runtime：`3002` Rust 后端动态刷新 CLI 探测，保留用户的 `3001` 实例且无需重启。
- Code：仅当真实联调发现兼容性问题时修改 `src-tauri/**` 或对应通用前端链路。
- Security：仅检查 CLI 返回的登录布尔状态和公开协议事件，不读取认证缓存。

## Acceptance Criteria

- [x] `codex --version` 可由普通子进程执行，并解析到 npm 全局 shim/独立 CLI。
- [x] `codex login status` 能安全确认账号状态，过程不输出凭据。
- [x] `POST /api/agents/codex/probe` 返回 installed/initialized 成功状态。
- [x] CodeM 新 Codex 聊天能收到真实文本增量和唯一终态。
- [x] 停止操作能结束真实 turn；刷新后同一线程可以通过 `thread/resume` 续聊。
- [x] Claude/Grok 探测与现有回归不受影响。
- [x] 若修改代码，Rust 测试、格式检查、TypeScript 检查和聚焦前端回归通过。

## Verification Commands

- `codex --version`
- `codex login status`
- `codex app-server --help`
- `Invoke-RestMethod -Method Post http://127.0.0.1:3002/api/agents/codex/probe`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm.cmd run typecheck`
- 聚焦 Codex/Provider/Agent 前端测试
- 浏览器或桌面端真实聊天 smoke

## Implementation Record
- 2026-07-12T14:00:38.486Z 通过 7890 代理安装官方 @openai/codex 0.144.1；npm shim 可由 Rust 启动，login status 为 ChatGPT 已登录，真实 probe 返回 installed=true、initialized=true、authenticated=true。完成后端文本/续聊/取消 smoke 与浏览器新建 Codex 聊天、SQLite session 持久化、刷新后 resume、UI 中断验证。联调发现停止图标辅助名称沿用发送，已为停止控件补 aria-label 并增加聚焦回归测试，运行逻辑不变。

- 2026-07-12T13:44:04.561Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T14:01:34.305Z `npm.cmd run typecheck && npm.cmd run build`: pass: typecheck/build 通过；仅既有 Vite dynamic import 与 chunk size 警告

- 2026-07-12T14:01:33.907Z `node --import tsx --test focused Codex/Provider/Agent/Composer suite`: pass: 40/40
- 2026-07-12T14:01:33.513Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

- 2026-07-12T14:01:33.128Z `cargo test --manifest-path src-tauri/Cargo.toml`: pass: 37 library + 9 desktop tests；1 authenticated Grok smoke ignored
- 2026-07-12T14:01:32.738Z `真实后端与浏览器 Codex smoke`: pass: 文本增量、唯一 done、thread/resume、SQLite session 持久化、刷新恢复和 UI interrupt/stopped 全部通过；Claude/Grok Registry 仍可用，页面无 console error

- 2026-07-12T14:01:32.353Z `POST http://127.0.0.1:3002/api/agents/codex/probe`: pass: installed=true, initialized=true, authenticated=true, authMode=chatgpt；command 为用户 npm codex.cmd
- 2026-07-12T14:01:31.941Z `codex --version; codex login status; codex app-server --help`: pass: codex-cli 0.144.1，可执行独立 CLI；ChatGPT 已登录；app-server stdio 可用

## Completion Summary
- 2026-07-12T14:02:17.630Z 已安装并启用官方 Codex CLI 0.144.1，真实 Provider probe、文本增量、唯一终态、SQLite session 持久化、刷新后 thread/resume 和 UI 中断均通过；停止控件补充可访问名称。Claude/Grok 不受影响，Rust 46 项通过（另 1 项 Grok smoke 跳过）、前端聚焦 40/40、格式/类型检查/生产构建通过。

## Follow-ups

- 真实联调稳定后，另行讨论 Codex 模型与 reasoning effort 配置。
