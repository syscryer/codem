# Task: 隔离自动化运行中的原生调度工具

## Background

CodeM 自动化会在到期后创建后台会话，并把用户保存的任务提示词交给对应 Agent 执行。Claude Code 2.1.211 内置 `CronCreate`、`CronDelete`、`ScheduleWakeup` 等原生调度工具；当自动化提示词包含“每天定时”等措辞且权限为完全访问时，模型可能把本次执行误判为“创建调度”，在项目 `.claude/scheduled_tasks.json` 中再创建一份 Claude 原生任务，导致 CodeM 自动化与 Claude Cron 重复运行且后者不受 CodeM UI 管理。

## Objective

CodeM 自动化执行时只运行当前任务一次，防止 Agent 再创建 Claude 原生 Cron 或唤醒任务，同时保持普通手动会话能力不变

## Scope

In scope:

- 为自动化触发的运行增加明确、不可见的执行上下文：当前只是 CodeM 已调度的一次执行，只完成一次工作，不创建、修改或删除其他调度。
- Claude Code 自动化运行通过 CLI 参数禁用原生调度/唤醒工具；普通手动会话不受影响。
- 自动化原始提示词和对话卡片继续展示用户保存的内容，不把内部控制文案污染到聊天历史。
- 通用 Agent 自动化请求携带同一执行语义，当前不改变其既有事件和会话协议。
- 补充前端请求映射和 Rust 参数构建回归测试。

Out of scope:

- 不删除已经存在的 `.claude/scheduled_tasks.json` 或 Claude 原生任务。
- 不在 CodeM 自动化页面导入、展示或管理 Claude 原生 Cron。
- 不禁止普通手动会话主动使用 Agent 自带的调度能力。
- 不改变 CodeM 自动化的 30 秒轮询、SQLite schema、运行状态或通知机制。

## Impact

- Frontend：`useAutomations` 标记自动化执行；`useClaudeRun` / `useAgentRun` 将标记送入运行请求，同时保持用户消息显示不变。
- Backend：Claude run request 增加自动化执行标记，并在 CLI 参数中加入系统约束和原生调度工具禁用项。
- Persistence：无 schema 变更；历史仍记录原始自动化提示词。

## Acceptance Criteria

- [x] CodeM 自动化触发 Claude 时，CLI 参数包含内部执行约束和原生调度工具禁用项。
- [x] 同一 Claude 手动会话不添加上述限制。
- [x] 自动化对话中的用户消息仍只展示原始任务提示词。
- [x] 自动化运行的模型、渠道、权限、思考等级和热会话路径保持不变。
- [x] Codex、Grok、OpenCode 等通用 Agent 请求不因新增标记而发生协议回归。
- [x] 定向测试、TypeScript typecheck、Rust 格式和差异检查通过。

## Verification Commands

- `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-run-context.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml automation_execution`
- `npm run typecheck`
- `rustfmt --edition 2021 --check <changed rust files>`
- `git diff --check`

## Implementation Record
- 2026-07-24T02:22:00.405Z 自动化运行增加独立 automationExecution 标记；Claude CLI 自动化调用追加一次性执行系统约束并禁用 CronCreate/CronDelete/CronList/ScheduleWakeup，通用 Agent 在后端运行输入前追加一次性执行上下文，聊天历史仍保留原始提示词。

- 2026-07-24T02:15:51.715Z Task created by Trellis automation.

## Verification Results
- 2026-07-24T02:32:23.387Z `git diff --check`: 通过

- 2026-07-24T02:32:23.090Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs src-tauri/src/backend.rs`: 通过
- 2026-07-24T02:32:22.786Z `npm run typecheck`: 通过

- 2026-07-24T02:32:22.501Z `cargo test --manifest-path src-tauri/Cargo.toml automation_execution`: 通过：2/2
- 2026-07-24T02:32:22.210Z `node --import tsx --test src/lib/automation-ui.test.ts src/lib/automation-run-context.test.ts`: 通过：12/12

## Completion Summary
- 2026-07-24T02:32:38.188Z 已隔离 CodeM 自动化与 Agent 原生调度：自动化请求显式携带执行标记；Claude 自动化运行追加一次性执行系统提示并禁用 CronCreate、CronDelete、CronList、ScheduleWakeup；通用 Agent 在运行输入中加入一次性执行上下文；普通手动会话、历史展示、模型、渠道、权限和思考等级保持原行为。定向前端测试、Rust 测试、TypeScript、rustfmt 和 diff 检查均通过。

## Follow-ups

- 后续如需统一管理外部 Agent 原生调度，应作为独立导入/同步功能设计，不能与本次运行隔离混在一起。
