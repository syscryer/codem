# Task: OpenCode 可用状态一致性

## Background

OpenCode 详情诊断能够识别本机可执行文件和版本，但 Provider Registry 仍可能保留应用启动时的瞬时失败结果，导致同一页面同时出现“已安装 / 可更新”和“不可用 / 不可选择”。两条接口使用了不同的命令解析入口，成功诊断不会更新 AgentRun 的命令缓存，也不会触发全局 Provider Registry 同步。

## Objective

修复 Provider Registry 与设置诊断状态不一致导致 OpenCode 已安装却显示不可用和不可选择

## Scope

In scope:

- Agent 设置诊断复用 AgentRun 的命令解析与缓存。
- 设置页用已安装诊断即时校正 active Provider 的可用和可选择状态。
- 检测到 Registry 与诊断不一致时后台刷新一次全局 Provider 列表。
- 补充 OpenCode 状态一致性回归测试和真实页面验证。

Out of scope:

- 不改变 OpenCode ACP 连接、认证和模型探测逻辑。
- 不改变普通聊天供应商或 Agent 渠道配置。

## Impact

- Backend: Agent settings diagnostics command resolution.
- Frontend: Agent Provider derived availability and registry synchronization.

## Acceptance Criteria

- [x] OpenCode 诊断识别为已安装时，设置列表、详情状态和默认 Agent 下拉均显示可用。
- [x] 成功诊断写入 AgentRun 命令缓存，后续 Provider Registry 刷新保持一致。
- [x] 状态不一致只触发一次后台同步，不造成刷新循环。
- [x] planned Provider 不会被诊断状态错误启用。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_command_resolution`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-16T06:34:21.818Z 统一 Agent 设置诊断与 AgentRun 命令缓存；前端对账 OpenCode 陈旧可用状态并限制后台同步为单次尝试；Playwright 模拟启动误判后验证恢复可用。

- 2026-07-16T06:20:18.407Z Task created by Trellis automation.
- 2026-07-16 根因证据：同一运行态 `/api/agents/providers` 与 `settings-diagnostics` 可返回不同状态；前者来自 AgentRun command cache，后者直接调用独立 resolver。
- 2026-07-16 后端诊断统一通过 `AgentRunService.resolve_command(provider_id, true)` 强制探测并更新命令缓存；Claude 保持原有解析流程。
- 2026-07-16 前端通过诊断结果即时校正 active Provider 的陈旧可用状态，并以 `providerId + command` 记录后台同步尝试，避免刷新循环。
- 2026-07-16 Playwright 拦截首个 Provider Registry 响应，将 OpenCode 模拟为 `available=false/selectable=false`；真实诊断完成后列表、详情和默认 Agent 下拉均恢复为可用。

## Verification Results

- 2026-07-16T06:34:56.774Z `git diff --check`: pass（仅既有 CRLF 提示）
- 2026-07-16T06:34:37.467Z `Playwright stale Registry 场景`: pass：OpenCode 列表、详情、默认 Agent 下拉均可用，控制台 0 error

- 2026-07-16T06:34:36.677Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass
- 2026-07-16T06:34:35.894Z `cargo test --manifest-path src-tauri/Cargo.toml agent_command_resolution`: pass：1/1

- 2026-07-16T06:34:35.012Z `npm run typecheck`: pass
- 2026-07-16T06:34:34.205Z `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`: pass：13/13

- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`：通过，13/13。
- `npm run typecheck`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml agent_command_resolution`：通过，1/1；仅有两个既存 `dead_code` warning。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- Playwright 真实页面：OpenCode 显示当前版本 `1.17.7`、最新版本 `1.18.2`、`已启用`、`聊天可用`，默认 Agent 下拉可选择 OpenCode；控制台 0 error。
- 验证截图：`output/playwright/opencode-status-consistency.png`。

## Completion Summary
- 2026-07-16T06:35:10.723Z 修复 OpenCode 已安装但 Provider Registry 陈旧状态导致不可用、不可选择的问题；统一后端命令缓存并增加前端受约束对账，测试与真实页面验证通过。

统一了 Agent 设置诊断与 Provider Registry 的命令解析缓存，并在前端为启动阶段的陈旧不可用状态增加受约束的即时对账和单次后台同步。OpenCode 已安装时不再出现“版本可识别但不可用、不可选择”的矛盾状态。

## Follow-ups

- 暂无。
