# Task: Agent Mux 真实概览与运行监控

## Background

Agent Hub 原型此前在概览、运行监控和连接状态中展示固定调用次数、成功率、运行记录与日志，容易让用户误认为真实 Agent Mux 执行链已经接入。配置持久化完成后，需要让概览与监控只展示可追溯的 SQLite 数据。

## Objective

移除 Agent Mux 概览和监控中的静态假数据，增加 SQLite 运行记录与真实汇总接口；无调用时显示空状态，为后续真实任务调用提供记录入口。

## Scope

In scope:

- 新增 `agent_mux_runs` SQLite 表和运行记录读写接口。
- 新增 Agent Mux 概览接口，汇总运行中、可用 Agent、今日调用和成功率。
- 前端移除固定指标、固定调用记录和固定日志。
- 无真实调用时展示明确空状态。
- Skill 预览根据数据库中的 Agent 配置动态生成。
- 后台连接状态以概览接口成功或失败为准。

Out of scope:

- 本阶段不启动真实 Agent 任务。
- 本阶段不接入实时事件流、取消运行或外部 Skill 服务。
- 不把普通 CodeM 会话运行自动计入 Agent Mux 调用。

## Impact

- Backend: `src-tauri/src/agent_mux.rs`
- Frontend API: `src/lib/agent-mux-api.ts`
- Frontend UI: `src/components/AgentMuxPrototype.tsx`
- Styles: `src/styles.css`

## Acceptance Criteria

- [x] 无运行记录时概览显示运行中 0、今日调用 0、成功率 `--`。
- [x] 无运行记录时概览和运行监控显示空状态，不展示伪造任务与日志。
- [x] Agent 可用数量从持久化配置状态派生。
- [x] Agent Mux 运行记录和汇总由 SQLite 接口返回。
- [x] 页面能够区分后台已连接和未连接。
- [x] Skill 预览中的 Agent / 模型列表来自当前数据库配置。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests`
- `git diff --check`
- Playwright CLI: Agent Hub 概览与运行监控空状态验证

## Implementation Record
- 2026-08-04T17:44:24.696Z 移除 Agent Hub 固定指标、固定调用记录和固定日志；新增 agent_mux_runs、真实概览汇总接口、空状态和动态 Skill 配置，后台连接状态改由概览请求结果驱动。

- 2026-08-04T17:26:06.315Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T17:44:24.792Z `GET http://127.0.0.1:5176/api/agent-mux/overview`: 通过；agents=4, runs=0, running=0, availableAgents=3, todayCalls=0, successRate=null
- 2026-08-04T17:44:24.750Z `npm run typecheck && npm run build`: 通过；Vite 仅有既有 chunk 大小警告

- 2026-08-04T17:44:24.713Z `Playwright CLI: Agent Hub 概览 -> 运行监控`: 通过；SQLite 数据、0 条调用、空状态正确，控制台 0 error / 0 warning
- 2026-08-04T17:44:24.680Z `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml agent_mux::tests`: 通过；Agent Mux 2 个新增测试通过，仅有既有警告

## Completion Summary
- 2026-08-04T17:44:39.730Z Agent Hub 已移除概览和监控中的静态假数据，改为 SQLite 运行记录与真实汇总；无调用时展示 0 和空状态，Skill 配置动态生成，后台连接状态真实反映接口结果。真实 Agent 调用与实时事件流留待下一阶段。

## Follow-ups

- 将真实 Agent Mux 调用写入运行记录，并接入实时事件流。
- 接入运行取消、失败原因与调用日志。
- 实现可安装、可鉴权的外部 `codem-agent-mux` Skill 服务。
