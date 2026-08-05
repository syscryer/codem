# Task: Agent Mux 真实任务调用

## Background

Agent Mux 原型已经具备 SQLite 配置和运行摘要接口，但首版仍会向数据库写入固定运行配置，配置抽屉中的供应商、模型和状态也没有由真实 Agent 渠道驱动。这些演示数据会让用户误以为 Agent 已经连接并正在运行。当前阶段需要先清除演示数据，再打通“真实配置 -> 连接检测 -> 发起任务 -> 事件持久化 -> 监控恢复”的完整链路。

## Objective

复用 CodeM 现有 Agent 运行能力，从 Agent Hub 启动真实任务，并将状态与输出写入 Agent Mux 监控记录。

## Scope

In scope:

- 保留 CodeM 支持的 Agent 类型目录，删除并迁移清理固定演示运行配置。
- 运行配置只能绑定 Agent 设置中真实存在的系统渠道或已启用自定义渠道，并从渠道读取可用模型。
- 配置的启停状态与连接检测状态分离，不能用固定 available/busy 状态伪造健康度。
- 从 Agent Mux 配置发起真实 Agent 任务，复用 `/api/agents/run` 的 NDJSON 事件流。
- 持久化公开输出、状态、错误摘要和 provider run id，刷新页面后可恢复监控记录。
- 对不支持独立通用运行的 Agent 明确禁用调用并解释原因。

Out of scope:

- 多 Agent 工作流编排。
- 外部 Skill 的鉴权、守护进程安装和跨进程调用协议。
- 保存隐藏思维链、API Key、base64 或附件全文。
- 为 Claude Code 新建第二套运行协议；首版只调用现有通用 Agent run 已支持的 provider。

## Impact

- Backend: `src-tauri/src/agent_mux.rs` SQLite schema、迁移和运行事件接口。
- Frontend: `src/components/AgentMuxPrototype.tsx` 配置、调用和监控交互。
- Contract: `src/lib/agent-mux-api.ts` 配置、运行和事件类型。
- Existing runtime: 只复用 `/api/agents/run`，不修改现有聊天线程运行语义。

## Acceptance Criteria

- [x] 新数据库和已有数据库都不再展示固定 Opus/Sonnet/sol/terra 等演示配置。
- [x] 未配置时展示 0 个运行配置和未连接状态，不显示伪造的可用或运行中状态。
- [x] 配置抽屉的渠道来自 Agent 设置真实数据，模型来自所选渠道的启用模型；无模型目录时允许明确的手动输入。
- [x] 保存、编辑、启停、删除和连接检测均作用于 SQLite 真实记录。
- [x] 支持的配置可以发起真实只读任务，并实时写入运行记录和公开输出事件。
- [x] 完成、失败、等待人工处理均有明确终态；刷新后状态和输出可恢复。
- [x] 类型检查、前端构建、Rust 检查、Agent Mux 单测和页面闭环验证通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests`
- Playwright 验证空配置、真实渠道配置、真实调用、刷新恢复和失败状态。

## Implementation Record

- 2026-08-04T18:45:57.531Z 真实验收使用 Codex gpt-5.6-sol：UI 调用返回 CODEM_MUX_OK；长任务取消后保持 cancelled；导出的 SKILL.md 被独立脚本读取并通过 HTTP 调用返回 EXTERNAL_SKILL_OK，随后在监控页恢复。
- 2026-08-04T18:45:56.800Z 完成 Agent Mux 真实闭环：清除演示配置，接入真实渠道与模型下拉、连接检测、任务启动、NDJSON 公开事件持久化、取消终态保护、刷新恢复，以及包含当前 API 地址和 profile 快照的 Skill 导出。

- 2026-08-04T17:46:04.206Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T18:46:00.485Z `git diff --check`: 通过；只有 Git 的 LF/CRLF 提示，无空白错误。
- 2026-08-04T18:45:59.735Z `Playwright Agent Mux E2E`: 通过：页面非空、无框架错误层、控制台无 error/warn；Skill 下载、真实成功运行、真实取消、刷新恢复和外部 Skill 调用监控均通过。

- 2026-08-04T18:45:59.024Z `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests`: 通过；Agent Mux 3 个单测全部通过，仅有既有 dead_code 警告。
- 2026-08-04T18:45:58.278Z `npm run typecheck && npm run build`: 通过；Vite 生产构建完成，仅有既有 chunk size 与动态导入提示。

## Completion Summary
- 2026-08-04T18:46:40.908Z Agent Mux 首阶段真实闭环完成：真实配置与探测、任务流与事件持久化、取消终态保护、刷新恢复、Skill 导出及外部调用均已验证通过。

Agent Mux 首阶段真实调用闭环已完成：配置、检测、调用、实时输出、SQLite 持久化、取消、刷新恢复、Skill 导出和外部 HTTP 调用均已验证。当前仍依赖 CodeM Backend 运行；常驻服务安装与鉴权属于后续任务。

## Follow-ups

- 外部 `codem-agent-mux` Skill 的本地服务常驻、鉴权和安装流程。
- 多 Agent 工作流编排。
