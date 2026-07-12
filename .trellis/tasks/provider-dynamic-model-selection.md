# Task: Grok 与 Codex 动态模型选择

## Background

CodeM 已完成 Grok ACP 与 Codex App Server 的主聊天接入，但 Composer 仍只对 Claude
展示模型与 effort 控件。Grok `0.2.93` 已通过 ACP initialize 动态返回可用模型，并支持
`session/set_model`；Codex `0.144.1` App Server 提供 `model/list`，且 `turn/start` 支持
`model` 和 `effort` 覆盖后续回合。模型目录会随账号、CLI 版本和服务端发布变化，不能在
CodeM 中硬编码。

## Objective

为 Grok 和 Codex 接入 Provider 动态模型目录、聊天级模型持久化与 Codex reasoning 选择，同时保持 Claude 现有模型链路不变

## Scope

In scope:

- 新增 Provider 中立的动态模型目录 API，Grok 从 ACP 能力读取，Codex 从
  `model/list` 分页读取；响应只保留公开模型元数据。
- Grok 在 `session/new|load` 后通过 `session/set_model` 应用显式模型。
- Codex 在 `turn/start` 传递动态模型和该模型实际支持的 reasoning effort。
- 复用线程 `model` 元数据，并为 Codex 增加可选 `reasoningEffort` 持久化；旧库增量兼容。
- 新聊天和已有 Grok/Codex 聊天显示模型选择器；Codex 额外显示动态 effort 选择器。
- `默认` 表示 Provider 当前默认模型，不在前端硬编码模型 ID；运行中锁定模型与 effort。
- 模型目录加载失败时保留 Provider 默认运行能力并提供重试；已保存模型失效时明确提示，
  当前 UI 回落到 Provider 默认但不静默改写线程元数据。
- 增加协议、API、持久化、前端状态与 UI 回归，并执行真实 Grok/Codex smoke。

Out of scope:

- 不修改 Claude `/api/claude/*`、`useClaudeRun` 或现有 Claude 模型菜单行为。
- 不新增全局 Grok/Codex 默认模型设置；本阶段只做聊天级选择。
- 不为 Grok 暴露 reasoning effort；当前 ACP 模型目录未广告每个模型支持的 effort 档位。
- 不实现附件、历史导入、Review、MCP/插件或账号管理扩展。
- 不保存模型目录原始响应、认证信息、隐藏模型或 Provider 私有元数据。

## Impact

- Backend：扩展 ACP/Codex 协议客户端、通用 Agent Run 请求与 Provider 模型目录路由。
- Frontend：扩展 `useAgentRun` 的聊天级模型状态，在 Composer 增加 generic Agent 模型控件。
- Persistence：线程表新增 nullable `reasoning_effort`，现有 `model` 字段扩展为 Provider 中立语义。
- Compatibility：Claude 专用运行链路和模型控件不改；没有显式选择时 Grok/Codex 沿用各自默认。
- Security：目录响应只包含模型 ID、名称、描述、上下文与公开 effort 能力，不记录 raw event。

## Acceptance Criteria

- [x] Grok 模型目录来自 ACP initialize，当前真实账号可看到动态默认与可选模型。
- [x] Codex 模型目录来自 `model/list`，包含默认模型及每个模型支持的 reasoning effort。
- [x] 新建和已有 Grok/Codex 聊天可以选择模型，刷新后选择保持一致。
- [x] Codex effort 选项随所选模型变化，切换模型时回落到该模型默认 effort。
- [x] Grok `session/set_model` 与 Codex `turn/start model/effort` 有协议测试和真实 smoke。
- [x] 运行中模型与 effort 控件禁用；失效模型和目录失败均有明确、可恢复状态。
- [x] 旧 SQLite 数据无需重建即可启动，线程 bootstrap/update/create 正确往返新字段。
- [x] Claude 模型菜单、发送、队列、附件和恢复回归不受影响。
- [x] Rust、TypeScript、聚焦前端测试和生产构建通过，相关开发服务已重启验证。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm.cmd run typecheck`
- `node --import tsx --test` 聚焦 Provider/Agent/Composer/Workspace 测试
- `npm.cmd run build`
- `git diff --check`
- 真实 Grok/Codex 模型目录、选择、刷新恢复与运行 smoke

## Implementation Record
- 2026-07-12T15:15:57.406Z 浏览器在 5173 -> 3002 开发环境验收 Grok/Codex 菜单、默认模型标识、Codex effort、刷新恢复和运行中禁用；临时线程与项目已删除。真实 CLI smoke：Grok 默认/非默认模型与 Codex gpt-5.4-mini + low 均返回 OK。

- 2026-07-12T15:15:56.998Z 完成前端模型选择闭环：useAgentRun 按 Provider 缓存并取消动态目录请求，线程级持久化 model/reasoningEffort；Composer 支持默认跟随、失效提示、重试、Codex effort 联动与运行中锁定；Claude 链路保持不变。
- 2026-07-12T14:29:32.342Z 完成动态模型协议层：Grok Driver 封装 session/set_model；Codex App Server 支持分页 model/list 并在 turn/start 传递 model/effort；新增统一 /api/agents/{providerId}/models 路由。cargo test --lib 38 passed, 1 ignored。

- 2026-07-12T14:16:57.162Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T15:16:00.228Z `真实 Grok/Codex 模型目录、选择、刷新恢复与运行 smoke`: 通过：Grok 目录 2 个模型、Codex 目录 6 个模型；Codex gpt-5.4-mini + low 刷新恢复，切换 gpt-5.6-sol 回落 medium，运行中权限/模型/effort 禁用；临时数据已清理。

- 2026-07-12T15:15:59.828Z `git diff --check`: 通过，无空白错误。
- 2026-07-12T15:15:59.433Z `npm.cmd run build`: 通过：Vite 2505 modules transformed；仅保留既有 chunk-size 提示。

- 2026-07-12T15:15:59.038Z `node --import tsx --test src/lib/agent-model-selection.test.ts src/lib/agent-provider-registry.test.ts src/lib/multi-provider-chat-routing.test.ts`: 通过：21 tests，0 failed。
- 2026-07-12T15:15:58.631Z `npm.cmd run typecheck`: 通过，TypeScript project references 无错误。

- 2026-07-12T15:15:58.223Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过，无格式差异。
- 2026-07-12T15:15:57.806Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 40 passed / 1 ignored，main 9 passed，bin/doc 0 failed。

## Completion Summary
- 2026-07-12T15:16:13.436Z 完成 Grok/Codex 动态模型选择方案 1：Provider 实时目录、会话级模型与 Codex effort 持久化、Grok session/set_model、Codex turn/start model/effort、Composer 交互/失效恢复/运行锁定全部落地；Claude 链路未改，测试、真实 CLI 与浏览器验收通过。

## Follow-ups

- 后续按 Provider 能力增加 Grok reasoning effort 或全局默认模型设置。
