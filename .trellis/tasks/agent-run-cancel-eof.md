# Task: 修复 Agent 取消后 EOF 状态

## Background

通用 Agent 在用户主动停止后，如果事件流静默 EOF 且没有返回终止事件，成功读取路径会把这次取消误判为运行失败。

## Objective

通用 Agent 在用户主动停止后静默结束事件流时保持已停止状态，非取消异常 EOF 继续展示失败原因，并补充回归测试。

## Scope

In scope:

- 统一取消标记、AbortController 和无终止 EOF 的收口判断。
- 保留非取消 EOF 的失败提示。
- 补充纯逻辑回归测试。

Out of scope:

- 不修改后端终止事件协议。
- 不改变用户主动停止以外的错误文案。

## Impact

- `src/hooks/useAgentRun.ts` 的通用 Agent 事件流结束分支。
- `src/lib/agent-run-events.ts` 及其测试。

## Acceptance Criteria

- [x] 取消标记或请求已 abort 时，无终止 EOF 显示“已停止”。
- [x] 未取消的无终止 EOF 仍显示运行失败原因。
- [x] 用户主动停止的既有路径保持不变。
- [x] 回归测试覆盖取消、abort、非取消三种状态。

## Verification Commands

- `node --import tsx --test src/lib/agent-run-events.test.ts`
- `npm run typecheck`
- `git diff --check`
- `curl.exe --max-time 5 http://127.0.0.1:5173/api/agents/providers`

## Implementation Record
- 2026-07-18T08:03:02.079Z 修复通用 Agent 取消后无终止 EOF 被误判失败：新增取消/abort 判定 helper，取消分支继续使用已停止，非取消 EOF 保持错误展示。

- 2026-07-18T07:56:48.536Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T08:03:02.377Z `node --import tsx --test src/lib/agent-run-events.test.ts and npm run typecheck and git diff --check`: 通过：8 个前端事件测试、TypeScript 检查和 diff 检查；桌面开发模式 API 返回 200。

- 前端事件测试 8/8 通过。
- TypeScript typecheck 通过。
- `git diff --check` 通过。
- 桌面开发模式已重启，Web 代理 API 返回 200。

## Completion Summary
- 2026-07-18T08:03:02.693Z 修复 Agent 主动停止后的静默 EOF 状态误判，补充取消、abort、非取消 EOF 回归覆盖，并重启桌面开发模式。

成功读取到 EOF 后先判断取消状态；主动停止统一保持“已停止”，只有非取消异常 EOF 才显示失败提示。

## Follow-ups

- 待补充。
