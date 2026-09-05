# Task: Agent 设置页优化

## Background

待补充背景。

## Objective

给 Kimi/Qwen/DSH/Hermes 添加运行诊断按钮；深层重构（统一 Probe/配置驱动）列为后续

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
- 2026-09-05T04:25:40.638Z 给 Kimi Code/Qwen Code/DeepSeek DSH/Hermes Agent 四家添加「运行诊断」按钮——后端 settings-diagnostics run=true 已支持（kimi doctor / qwen --version / dsh --version / hermes --version），前端只缺入口。原有五家检测连接按钮和 Claude Code 重新检测不变。typecheck 通过、契约测试全过。深层重构（统一 Probe 管理为 map/条件链配置化/defaultAgentProviderName 查表）因涉及 resolveProviderStatus/formatProviderListMeta 等多函数签名连锁变更，单次改动风险高，列为 Follow-up 独立任务。

- 2026-09-05T04:25:40.123Z Task created by Trellis automation.

## Verification Results

## Completion Summary

## Follow-ups

- 待补充。
