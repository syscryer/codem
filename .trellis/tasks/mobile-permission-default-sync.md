# Task: 移动端权限默认值跟随桌面端

## Background

待补充背景。

## Objective

移动端新建任务/发送任务的权限模式初始值改为桌面端设置里的 defaultPermissionMode，而不是硬编码 default；网关 bootstrap 增加该字段

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
- 2026-08-22T15:15:25.388Z 实现：网关 bootstrap 增加拉取桌面 /api/settings，输出 defaults{permissionMode, modelId, providerId}（渠道默认沿用 channels.defaultChannelIds）；MobileBootstrap 类型加 defaults；NewTaskPage 的 Agent/模型/权限初始值与 TaskDetailPage 的权限初始值改为跟随桌面默认，渠道默认逻辑已有。注意：后端 defaultPermissionMode 合法值为 default/auto/bypassPermissions（acceptEdits 会被回落为 default）

- 2026-08-22T15:07:56.898Z Task created by Trellis automation.

## Verification Results
- 2026-08-22T15:15:26.560Z `隔离环境实测`: 桌面默认权限设为 auto 后，移动端新建任务页权限初始值显示'自动执行'；Agent 默认 Claude Code、模型默认 Provider 默认均正确跟随；测试后已恢复设置并清理标签页

- 2026-08-22T15:15:26.161Z `npm run typecheck + node --import tsx --test src/mobile/*.test.ts`: typecheck 通过；移动端 44 个测试通过
- 2026-08-22T15:15:25.774Z `cargo test --lib mobile_companion`: 48 个测试通过（新增 bootstrap_carries_desktop_task_defaults 与 bootstrap_defaults_fall_back_when_settings_missing）

## Completion Summary
- 2026-08-22T15:15:26.940Z 移动端任务默认配置跟随桌面端：bootstrap 携带 defaults（权限/模型/Agent），新建任务与发送任务的初始选择与桌面一致，渠道默认沿用原有 defaultChannelIds 机制

## Follow-ups

- 待补充。
