# Task: 多 Agent Runtime 基础架构

## Background

CodeM 当前运行链路以 Claude Code 为唯一实现，数据库虽然已经保存 `thread.provider`，但新建线程、运行路由、事件类型和前端 hook 仍带有 Claude 专用命名。后续计划接入 Grok Build、OpenAI Codex 和自研 Agent；如果继续按 CLI 逐套复制运行链路，会导致会话、工具、审批、附件、历史和恢复逻辑分叉。

本阶段先建立最小的 Provider/Runtime 公共契约，不把未完成 Provider 接入实际发送路径。用户明确要求尽可能不影响当前 Claude Code（CC）的使用，因此兼容性优先于一次性重命名或大规模重构。

## Objective

建立可扩展到 Grok、Codex 和自研 Agent 的 Provider/Runtime 抽象，同时保持现有 Claude Code 路由、事件、会话和运行行为兼容

## Scope

In scope:

- 定义协议中立的 Agent run event 名称，同时保留 `ClaudeEvent` 兼容别名。
- 定义 Provider、Driver、生命周期和 capability 的稳定数据契约。
- 在 Rust 后端增加只读 Provider Registry；Claude Code 是唯一 active Provider，Grok/Codex/自研 Agent 只登记为 planned。
- 增加注册表契约和兼容别名测试。
- 记录后续 ACP、Codex JSON-RPC 和自研 Agent 的接入边界。

Out of scope:

- 不启动 Grok、Codex 或自研 Agent 进程。
- 不增加 Provider 选择 UI，不允许用户选择 planned Provider。
- 不修改 `/api/claude/*` 路由、payload、stream event 或 Claude CLI 参数。
- 不修改 `useClaudeRun` 的运行时状态机，不重命名现有 Claude 专用文件。
- 不修改 SQLite schema、现有 thread provider 值或历史导入逻辑。
- 不保存或管理 API key、token、CLI 登录缓存。

## Impact

- frontend：`src/types.ts` 增加公共类型和兼容别名；只新增独立 Provider Registry 客户端/测试，不接入现有 UI。
- backend：新增独立 Agent Provider Registry 模块和只读查询路由；Claude runtime 实现保持不变。
- persistence：无 schema 和数据迁移。
- security/privacy：注册表只返回产品、协议、能力和本机可用状态，不返回凭据、环境变量或 Provider 配置内容。

## Acceptance Criteria

- [x] `ClaudeEvent` 继续可被现有 `useClaudeRun` 和 conversation helper 无改动消费。
- [x] Claude Code 保持唯一 active Provider，现有 `/api/claude/*` 代码路径和请求格式不变。
- [x] Grok、Codex、自研 Agent 可以作为 planned Provider 登记，但不能被当作当前可选择 Provider。
- [x] Provider capability 可以表达 supported、unsupported、runtime-detected，取消能力可以区分 none、hard、soft 和 runtime-detected。
- [x] Provider Registry 的 ID 唯一，active Provider 必须有明确可用状态，planned Provider 不伪报安装状态。
- [x] Rust tests、frontend contract tests、typecheck 和 diff check 通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npx tsx --test src/lib/agent-provider-registry.test.ts src/lib/conversation.test.ts src/lib/queued-prompts.test.ts src/lib/claude-run-attachments.test.ts src/hooks/useClaudeRun.send-latency.test.ts`
- `npm run typecheck`
- 隔离 Rust 后端验证 `/api/agents/providers`、`/api/health`、`/api/claude/models`、`/api/runtime/identity`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-12T08:17:08.152Z 已确定增量兼容边界并完成基础实现：新增只读 Agent Provider Registry、capability 契约和 AgentRunEvent 通用名称；ClaudeEvent 保持兼容，现有 /api/claude 路由、Claude runtime、useClaudeRun、SQLite schema 与历史逻辑均未改动。Grok/Codex/CodeM Agent 仅登记为 planned 且不可选择。

- 2026-07-12T08:08:28.651Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T08:17:37.654Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check; git diff --check`: 通过：Rust 格式无差异；diff check 无空白错误，仅提示仓库现有 Windows LF/CRLF 转换警告。

- 2026-07-12T08:17:37.272Z `隔离 Rust 后端 39210：GET /api/agents/providers、/api/health、/api/claude/models、/api/runtime/identity`: 通过：Claude Code 是唯一 active provider 且 available/selectable=true；Grok/Codex/CodeM Agent 均 planned、available=null、selectable=false；原 health/models/identity 接口正常。
- 2026-07-12T08:17:36.895Z `npm.cmd run typecheck`: 通过：TypeScript project references 编译无错误，ClaudeEvent 与 AgentRunEvent 兼容。

- 2026-07-12T08:17:36.513Z `npx.cmd tsx --test src/lib/agent-provider-registry.test.ts src/lib/conversation.test.ts src/lib/queued-prompts.test.ts src/lib/claude-run-attachments.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: 通过：38/38；Provider Registry 契约及 Claude 事件、停止、队列、附件、恢复关键回归全部成功。
- 2026-07-12T08:17:36.129Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 11/11、桌面 main 9/9、doc tests 0 失败；覆盖 Agent Registry、Claude 历史导入、Windows Claude CLI 发现与桌面基础行为。

## Completion Summary
- 2026-07-12T08:18:36.694Z 完成多 Agent Runtime 基础阶段：建立 Provider/capability 契约、通用 AgentRunEvent 兼容层、Rust 只读 Provider Registry 与前端严格解析；Claude Code 保持唯一 active Provider，原 Claude 路由、runtime、hook、持久化和正在运行的 3001 服务均未改动或重启。Rust 20 项与前端 38 项关键回归、typecheck、格式和隔离 API 验证全部通过。

## Follow-ups

- 在独立任务中实现 ACP Driver，并用 Grok Build 做首个协议适配 POC。
- 在 ACP 基础稳定后接入 Codex 官方稳定协议，校验 capability 模型是否足够通用。
- 自研 Agent 优先实现 ACP；只有 ACP 无法表达的能力才增加 CodeM 扩展命名空间。
- Provider 选择、安装/登录状态和多账号配置在运行链路验证完成后单独设计。
