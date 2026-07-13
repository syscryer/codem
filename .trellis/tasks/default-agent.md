# Task: 默认 Agent 设置

## Background

CodeM 已支持 Claude Code、Grok Build 和 OpenAI Codex Provider，但新聊天草稿仍固定从 Claude Code 开始，设置页也只能控制实验 Agent 运行开关。用户需要显式配置以后新建聊天默认使用的 Agent，并在桌面重启后保留该选择。

## Objective

在 Agent 设置中增加默认 Agent 选择，出厂默认 Claude Code，仅影响新建聊天并持久化到本地设置

## Scope

In scope:

- 在 Agent 运行时设置中持久化 `defaultProviderId`。
- 出厂默认值固定为 `claude-code`。
- 在“设置 -> Agent 与模型 -> 提供商”中提供统一样式的默认 Agent 下拉选择。
- 普通新聊天、斜杠命令触发的新聊天和项目首次自动创建的聊天统一使用默认 Agent。
- 设置更新后，下一次进入新聊天草稿时立即生效。
- 默认 Agent 不可用时沿用现有 Provider 校验并明确报错。

Out of scope:

- 不修改已有聊天已经绑定的 Provider。
- 不在默认 Agent 不可用时静默切换到其他 Provider。
- 不改变现有聊天中的 Provider、模型或权限切换规则。
- 不修改 Claude Code、Grok Build、OpenAI Codex 各自的运行协议。

## Impact

- Frontend：设置类型、设置状态、Provider 设置界面、新聊天草稿与创建链路。
- Backend：Rust 设置归一化及 `/api/agents/runtime-settings` 读写响应。
- Persistence：继续写入现有本地 `settings.json` 的 `agentRuntime` 节点，不新增存储介质。

## Acceptance Criteria

- [x] 全新安装或缺少该字段时，默认 Agent 为 Claude Code。
- [x] 用户可在设置页选择 Claude Code、Grok Build 或 OpenAI Codex，并持久化到本地设置。
- [x] 选择只影响以后新建的聊天，已有聊天 Provider 保持不变。
- [x] 普通新聊天、斜杠命令新聊天、项目首次自动建聊均携带默认 `providerId`。
- [x] 默认 Agent 不可用时不自动降级，创建聊天时显示现有后端校验错误。
- [x] 前后端归一化对非法 `defaultProviderId` 回到 `claude-code`。
- [x] 桌面开发版重启后仍能读取并使用已保存的默认 Agent。

## Verification Commands

- `npm run typecheck`
- `node --test --import tsx src/lib/settings-api.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/agent-provider-management-ui.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- 桌面开发版真实切换默认 Agent、新建聊天并重启验证持久化。

## Implementation Record

- 2026-07-13T15:49:57.103Z 已完成默认 Agent 前后端设置契约、设置页下拉和全部新聊天入口接入；前端 typecheck 与 25 个定向测试通过，Rust cargo test 通过 54+9 项。
- 2026-07-13T15:33:02.632Z 已确认默认 Agent 需求边界：出厂默认 Claude Code，仅影响以后新建聊天，所有新聊天入口统一使用，Provider 不可用时明确报错且不静默降级。

- 2026-07-13T15:28:39.645Z Task created by Trellis automation.

## Verification Results

- 2026-07-13T16:12:26.370Z `git diff --check`: 通过，仅有 Windows 行尾提示，无空白错误。
- 2026-07-13T16:12:25.615Z `Playwright 设置页桌面与 480px 视口检查`: 默认 Agent 下拉、品牌图标、可用状态和响应式布局正常，控制台 0 error。

- 2026-07-13T16:12:24.782Z `真实 API 与桌面重启验证`: 非法 Provider 回落 Claude；Codex/Claude 新聊天 Provider 正确；Codex 设置跨重启保留；最终恢复 Claude Code。
- 2026-07-13T16:12:23.979Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml`: 通过，Rust lib 54 项通过、1 项需显式真实 Grok 环境而忽略，桌面 main 9 项通过。

- 2026-07-13T16:12:23.182Z `node --test --import tsx src/lib/settings-api.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/agent-provider-management-ui.test.ts`: 通过，25 项定向测试全部成功。
- 2026-07-13T16:12:22.353Z `npm run typecheck`: 通过，TypeScript 项目检查无错误。

## Completion Summary
- 2026-07-13T16:12:43.910Z 新增默认 Agent 设置：出厂默认 Claude Code，设置页支持带品牌图标的 Provider 选择；完整持久化到 Rust 设置，统一接入普通新聊天、斜杠命令、工作树和克隆首聊；已有聊天不变，不可用 Provider 不自动降级。前后端测试、真实 API、跨重启持久化和桌面/窄屏 UI 均验证通过。

## Follow-ups

- 无。
