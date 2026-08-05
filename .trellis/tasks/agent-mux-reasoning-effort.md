# Task: Agent Mux 默认思考等级

## Background

待补充背景。

## Objective

运行配置支持按模型选择思考等级，默认跟随模型，并持久化后传入真实 Agent 调用

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

- 2026-08-05T13:35:42.182Z 完成思考等级闭环：抽屉按模型目录展示等级，默认跟随模型；ProfileRow 回显；SQLite 新增兼容列；桌面 API、Skill 清单和独立 CLI 均透传 reasoningEffort。Runtime 在无运行任务时完成重建并恢复。
- 2026-08-05T13:23:30.628Z 方案确认：思考等级属于运行配置；默认值为空，界面显示跟随模型默认（可展示模型默认等级）；选项来自模型目录；保存到 SQLite reasoning_effort，桌面调用与 codem-agent-mux CLI 均传 reasoningEffort；旧配置按默认值兼容。

- 2026-08-05T13:20:39.715Z Task created by Trellis automation.

## Verification Results
- 2026-08-05T13:35:45.460Z `codem-agent-mux agents --json`: pass: Runtime 重启成功，真实 profiles 输出 reasoningEffort 字段，旧配置为 null

- 2026-08-05T13:35:44.776Z `npm run typecheck && npm run build`: pass
- 2026-08-05T13:35:44.138Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: pass: 3/3

- 2026-08-05T13:35:43.463Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux --lib`: pass: 14/14 Agent Mux tests
- 2026-08-05T13:35:42.806Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: pass: 12/12

## Completion Summary
- 2026-08-05T13:35:59.043Z Agent Mux 运行配置已支持模型感知的思考等级，默认跟随模型；配置持久化并贯通桌面与外部 Skill CLI 调用，旧配置兼容。

## Follow-ups

- 待补充。
