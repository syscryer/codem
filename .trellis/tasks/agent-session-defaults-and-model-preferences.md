# Task: Agent 会话默认权限与模型偏好持久化

## Background

基础设置已经提供“默认权限模式”，但当前只有 Claude Code 草稿会读取它；Codex、Grok Build、OpenCode 等通用 Agent 草稿仍固定从 `default` 开始。与此同时，线程虽然保存当前模型和 Codex 当前思考级别，Claude Code 的 effort 没有持久化，Codex 也无法在同一会话切回模型时恢复该模型之前的思考级别。

## Objective

让所有 Agent 新会话继承基础设置权限，并按会话与模型持久化思考级别

## Scope

In scope:

- Claude Code、Codex、Grok Build、OpenCode 等 Agent 的新会话统一继承基础设置中的默认权限模式。
- 已有会话继续使用自己的线程级权限；缺少权限元数据的旧会话回落到当前基础设置。
- 当前模型继续按线程保存，思考级别按 `thread + model` 保存；切换模型时恢复当前会话中该模型上次使用的值。
- `__default` 作为 Provider 默认模型的稳定偏好键，不绑定某次动态解析出的具体模型。
- 新线程首次发送时一次性写入 provider、权限、模型和思考级别。
- 保存失败返回明确错误，前端提示并回滚本次选择。
- 迁移已有 `threads.reasoning_effort` 快照，并保持旧数据库可直接升级。

Out of scope:

- 不跨会话共享模型思考偏好。
- 不持久化尚未首次发送的新会话草稿。
- 不改变普通聊天的 provider/model 机制。
- 不为本身没有思考级别目录的 Agent 虚构选项。

## Impact

- Frontend：`useClaudeRun`、`useAgentRun`、`useWorkspaceState`、线程类型和模型偏好 helper。
- Backend：SQLite schema、线程创建/更新事务、workspace bootstrap payload。
- Settings：只消费现有 `general.defaultPermissionMode`，不新增设置项。

## Acceptance Criteria

- [x] 基础设置为完全访问时，新建 Claude/Codex/Grok/OpenCode 会话均显示并提交完全访问。
- [x] 已有会话的权限选择独立保存，切换会话和重启后恢复。
- [x] 同一会话在模型 A/B 间切换时，分别恢复各自上次的思考级别。
- [x] Claude Code effort 与 Codex reasoning effort 均可刷新恢复。
- [x] 新会话首次请求失败时，已经创建的线程仍包含本次权限、模型和思考级别。
- [x] 无效或已不支持的思考级别会明确提示，并更新为该模型当前默认值。
- [x] 元数据保存非 2xx 时前端收到异常、显示错误并回滚控件。
- [x] 旧数据库升级后保留原 Codex 当前思考级别，并生成对应模型偏好。

## Verification Commands

- `node --import tsx --test src/lib/thread-model-preferences.test.ts src/lib/agent-model-selection.test.ts src/lib/grok-permission-modes.test.ts src/lib/multi-provider-chat-routing.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_database_adds_thread_model_preferences`
- `cargo test --manifest-path src-tauri/Cargo.toml thread_model_preferences_follow_model_switches`
- `git diff --check`

## Implementation Record
- 2026-07-15T14:03:38.038Z 完成跨层实现：新增 thread_model_preferences 表与旧快照迁移；线程创建和模型偏好写入使用事务；Claude/Codex 按会话+模型恢复思考级别；所有 Agent 新草稿继承基础设置默认权限；元数据保存失败抛错并回滚控件；bootstrap 一次读取全部模型偏好避免逐线程查询。

- 2026-07-15T13:46:03.282Z Task created by Trellis automation.

## Verification Results
- 2026-07-15T14:21:03.498Z `真实 Rust API 模型偏好往返`: Codex gpt-5.6-sol=high、gpt-5.6-terra=low；Claude MiniMax-M3=high、glm-5.2=low；切回模型恢复原值，测试线程 0 残留且原选择已恢复

- 2026-07-15T14:21:02.652Z `Playwright 新建 Agent 草稿`: 基础设置为完全访问时，Claude Code、OpenAI Codex、Grok Build、OpenCode 均显示权限模式：完全访问；控制台 0 error
- 2026-07-15T14:21:01.823Z `npm run typecheck && cargo fmt --check && git diff --check`: 全部通过，无类型、格式或空白错误

- 2026-07-15T14:21:00.982Z `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast`: 通过：lib 121/121、main 9/9；1 个需真实 Grok 登录的 smoke test 按预期 ignored
- 2026-07-15T14:21:00.201Z `前端完整测试`: 通过：481/481，包含默认权限、首次创建元数据、保存失败回滚和模型偏好测试

## Completion Summary
- 2026-07-15T14:21:36.324Z 完成 Agent 会话默认权限和按模型思考偏好持久化：所有 Agent 新草稿继承基础设置，Claude/Codex 按线程+模型恢复 effort，SQLite 迁移与事务、保存错误回滚、完整测试和浏览器/API 验证均通过。

## Follow-ups

- 根据本机可用 Agent 做桌面端手工验证；没有 reasoning effort 能力的 Agent 只验证默认权限。
