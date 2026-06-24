# Task: GLM 5.2 1M Context Adaptation

## Background

GLM-5.2 通过 Claude Code 兼容网关使用时支持 `GLM-5.2[1m]` 这类 1M 上下文 alias。CodeM 当前只对 Claude family 的 Sonnet / Opus 槽位显示 1M 开关，GLM-5.2 默认只能按普通 200k 上下文模型处理，导致模型选择和上下文窗口展示不准确。

## Objective

适配 GLM-5.2[1m] 等非 Claude 模型的 1M 上下文模型选择和上下文窗口估算。

## Scope

In scope:

- 后端模型选项识别 GLM-5.2 的 1M alias。
- 默认模型配置为 GLM-5.2 时，也能提供 `GLM-5.2[1m]` 入口。
- 保持 GLM-5.1 等旧 GLM 模型不自动显示 1M。
- 保持 `CLAUDE_CODE_DISABLE_1M_CONTEXT` 禁用语义。
- 补充后端模型选项和前端上下文估算测试。

Out of scope:

- 不新增完整 provider 能力配置系统。
- 不把所有未知模型都默认当 1M。
- 不改 Claude CLI 运行参数协议。

## Impact

- `server/lib/claude-models.ts`
- `server/lib/claude-models.test.ts`
- `src/lib/composer-context-usage.test.ts`

## Acceptance Criteria

- [x] `GLM-5.2` 默认模型和 Sonnet / Opus 映射能生成 `GLM-5.2[1m]`。
- [x] `glm-5.1` 不显示 1M 开关。
- [x] `CLAUDE_CODE_DISABLE_1M_CONTEXT=true` 时 GLM-5.2 也不显示 1M。
- [x] `GLM-5.2[1m]` 的 Composer 上下文窗口估算为 1,000,000 tokens。

## Verification Commands

- `npx tsx --test server/lib/claude-models.test.ts`
- `npx tsx --test src/lib/composer-context-usage.test.ts src/lib/claude-model-selection.test.ts src/lib/ui-labels.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-06-22T02:14:52.277Z 适配 GLM-5.2 1M 上下文：后端对 GLM-5.2 生成 [1m] 变体，前端测试确认 GLM-5.2[1m] 按 1M 窗口估算。

- 2026-06-22T02:09:11.304Z Task created by Trellis automation.

## Verification Results
- 2026-06-22T02:17:43.275Z `npm run typecheck`: pass

## Completion Summary
- 2026-06-22T02:17:52.806Z 完成 GLM-5.2 1M 上下文适配，保留 GLM-5.1 默认行为，并补齐类型检查发现的重连 RunContext 中断字段。

## Follow-ups

- 待补充。
test.ts src/lib/claude-model-selection.test.ts src/lib/ui-labels.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: pass 34/34

## Completion Summary

## Follow-ups

- 待补充。
