# Task: 对齐提问与审批控制流

## Background

待补充背景。

## Objective

对照原版实现修复 Rust 后端中 request-user-input 与 approval-decision 的协议差异，并验证前端交互路径

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record
- 2026-07-04T18:39:40.642Z 对齐 Rust 后端提问/审批控制流：补充运行态暂停标记、control request 到 tool_use_id 映射反查、request/approval 去重、bypassPermissions 权限自动审批、AskUserQuestion 答案归一化，并让 stream 分片工具输入也能触发交互卡片。

- 2026-07-04T18:23:01.628Z Task created by Trellis automation.

## Verification Results

- 2026-07-04T18:40:07.076Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend；cargo check --manifest-path src-tauri/Cargo.toml --bin codem；npm run typecheck；git diff --check`: 通过：两个 Rust bin 编译检查通过，TypeScript typecheck 通过，diff 空白检查通过。
- 2026-07-04T18:39:52.305Z `真实 Claude 接口验证：39203 隔离 Rust 后端，default 模式触发 approval-request 并两次提交 approval-decision，最终 done；default 模式触发 request-user-input，提交 request-user-input 后最终 done；bypassPermissions 模式未出现审批卡。`: 通过：审批提交 trace=2，提问提交 trace=1，两个端到端 run 均返回 done；bypassPermissions run 没有误弹 approval-request。

## Completion Summary
- 2026-07-04T18:40:42.309Z 已对齐 Rust 后端提问与审批控制流：真实 Claude default 审批、真实 Claude 提问提交、bypassPermissions 不误弹审批均验证通过；编译、typecheck 和 diff check 通过。

## Follow-ups

- 待补充。
