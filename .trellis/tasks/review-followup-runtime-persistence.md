# Task: 修复运行资源与持久化边界

## Background

近期长任务性能改动为 Claude 流式增量提交新增了独立的 animation frame，代码审查发现卸载清理没有同步覆盖完整 RunContext 资源。同时，Grok PATH 探测未验证候选命令是否可运行；会话删除与历史持久化调度也存在 timer/Map 残留和活跃重试周期被新事件重置计数的问题。

## Objective

补齐 Claude 运行清理、Grok 命令验证和会话历史持久化状态清理及重试上限语义

## Scope

In scope:

- `useClaudeRun` 卸载时中止请求，清理所有 frame、timer 和运行索引。
- Grok PATH 探测只接受能成功响应 `--version` 的可启动候选命令。
- 删除 thread 时同步清理对应历史持久化 timer、状态 Map 和待刷日志批次。
- 历史持久化的新事件不得重置正在进行或等待重试的周期计数；周期结束后新写入仍可获得新的重试预算。
- 补充覆盖上述边界的前端与 Rust 回归测试。

Out of scope:

- 不改变 Agent streaming event contract、SQLite schema 或历史数据格式。
- 不在本任务中拆分 `backend.rs`，不统一重构各 Provider 的完整命令解析流程。
- 不扩展为本地 API 安全审计或安全加固任务。

## Impact

- frontend runtime：`src/hooks/useClaudeRun.ts`
- frontend workspace persistence：`src/hooks/useWorkspaceState.ts`
- backend Agent lifecycle detection：`src-tauri/src/backend.rs`
- 对应 TypeScript/Rust 测试文件

## Acceptance Criteria

- [x] Claude runtime hook 卸载后不存在遗留请求、frame、interrupt timer 或 RunContext 索引。
- [x] PATH 中不可响应 `--version` 的 Grok 候选不会被当作可用 CLI。
- [x] 删除 thread 后，对应持久化 timer 被取消且两个状态 Map 不保留该 thread。
- [x] 活跃写入/重试期间到达的新事件不会把 retryCount 重置为零；已结束周期后的新写入会重置预算。
- [x] 定向测试、TypeScript 类型检查、Rust 格式和相关 Rust 测试通过。

## Verification Commands

- `node --import tsx --test src/hooks/useWorkspaceState.history-persistence.test.ts src/hooks/useClaudeRun.cleanup.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::grok_path_command_candidates_require_version_check`

## Implementation Record

- 2026-07-17T06:40:53.891Z 已完成实现：Claude 普通运行和热会话重连均可在卸载/硬停止时取消，两个 frame、interrupt timer 和运行索引完整清理；Grok PATH 候选逐个执行版本验证；thread 删除立即清理历史 timer、状态 Map、日志批次和 ref，活跃重试周期不再被新事件重置。
- 2026-07-17T06:29:38.347Z 已确认三组修复边界：Claude 卸载资源清理、Grok PATH 候选版本验证、thread 删除与历史重试状态收口；不改事件协议、SQLite schema 或 backend.rs 模块结构。

- 2026-07-17T06:28:33.179Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T06:41:19.888Z `npm run typecheck && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 全部通过；仅 Git 提示现有行尾转换，不存在 whitespace error

- 2026-07-17T06:41:11.672Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust lib 148 项通过、1 项需真实 Grok 环境而忽略；main 9 项通过，0 失败
- 2026-07-17T06:41:03.383Z `node --import tsx --test src/hooks/*.test.ts src/lib/*.test.ts`: 499 项通过，0 失败

## Completion Summary
- 2026-07-17T06:41:52.750Z 完成 Claude 普通运行及热会话重连资源清理、Grok PATH 候选版本验证，以及 thread 删除/历史重试状态收口；前端相关 499 项、Rust 157 项和类型/格式检查通过。

## Follow-ups

- `backend.rs` 模块拆分和本地 API 安全边界审计另行规划，不与本次小范围修复混合。
