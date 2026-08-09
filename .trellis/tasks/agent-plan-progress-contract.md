# Task: 补充 Agent 计划步骤接入规则

## Background

`codem-agent-onboarding` Skill 以 `openspec/agent-provider-onboarding.md` 为唯一事实来源，但现有规范只泛化提到 Plan 和上下文岛，没有明确要求新增 Provider 将结构化步骤归一化并接入岛内进度。

## Objective

明确新增 Provider 的结构化计划步骤归一化、上下文岛展示、持久化恢复和验收要求

## Scope

In scope:

- 补充 Provider 中立的结构化计划/步骤接入规则。
- 明确上下文岛、实时事件、历史恢复、SQLite 和隔离边界。
- 为 OpenSpec 关键规则增加最小自动化门禁。

Out of scope:

- 本任务不实现新的统一计划事件或修改当前岛内步骤组件。
- 不从自然语言或终端文本推断计划。

## Impact

- `openspec/agent-provider-onboarding.md`
- `src/lib/agent-provider-onboarding-contract.test.ts`

## Acceptance Criteria

- [x] 规范明确覆盖 `TodoWrite`、`update_plan` 和 Provider 原生计划事件。
- [x] Frontend 只消费 Provider 中立的统一计划投影。
- [x] 规范覆盖上下文岛、完成收起、历史恢复和 thread/run 隔离。
- [x] 规范禁止从普通文本猜测步骤。
- [x] onboarding contract 测试能防止该规则缺失。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-onboarding-contract.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-08-08T06:14:44.364Z 在 Agent Provider 唯一 OpenSpec 中新增 Structured Plan And Progress 合同，覆盖 TodoWrite、update_plan、Provider 原生计划事件的统一映射、上下文岛展示、完成收起、实时/历史/SQLite 一致性、thread/run 隔离和禁止文本猜测；并为合同测试增加防回归断言。

- 2026-08-08T06:10:09.163Z Task created by Trellis automation.

## Verification Results

- 2026-08-08T06:14:47.449Z `python codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: pass: 69 frontend tests, typecheck, cargo fmt, 11 runtime tests, 5 automation tests, production build
- 2026-08-08T06:14:46.646Z `git diff --check`: pass

- 2026-08-08T06:14:45.832Z `npm run typecheck`: pass
- 2026-08-08T06:14:45.099Z `node --import tsx --test src/lib/agent-provider-onboarding-contract.test.ts`: pass: 3 tests

## Completion Summary
- 2026-08-08T06:15:01.242Z 已将结构化计划/步骤接入要求写入 Agent Provider 唯一 OpenSpec，并增加合同门禁；规则覆盖统一映射、上下文岛进度、完成收起、历史恢复、隔离和禁止文本推断。完整 onboarding 自动化门禁通过。

## Follow-ups

- 后续实现统一计划投影时，按本合同补齐各 Provider 的映射和真实 CLI 验收。
