# Task: 统一 Agent 默认渠道与渠道管理体验

## Background

Agent 渠道目前只把系统配置作为隐式默认，CodeM 渠道的默认星标没有贯通新任务、新自动化和输入区；设置页又把系统配置与 CodeM 渠道拆成两套布局，长地址、删除入口、厂商图标和模型说明都不够清晰。

## Objective

支持系统与 CodeM 渠道统一默认选择，重构渠道管理列表和输入区菜单，并精简模型配置体验

## Scope

In scope:

- 为 Claude Code、Codex、Grok、OpenCode 分别维护系统或 CodeM 默认渠道。
- 新任务、新草稿和新自动化继承当前 Provider 的默认渠道；已有会话保持持久化选择。
- 将设置页重构为统一渠道列表和右侧详情，系统渠道只读展示，CodeM 渠道可编辑和删除。
- 输入区渠道菜单展示厂商图标并提供“管理渠道”入口；精简模型菜单长文案。
- 前端移除模型列表地址输入，但后端字段继续兼容已有配置和 Grok 运行时。
- 持久化渠道厂商模板标识，用于稳定展示厂商图标。

Out of scope:

- 不修改 Agent CLI 自身系统配置或 CC Switch 数据。
- 不改变已有会话已保存的渠道选择。
- 不移除后端 `models_url` 兼容字段。

## Impact

- 后端 Agent 渠道数据库、bootstrap 与默认渠道 API。
- 新任务/自动化初始化状态、设置页和 Composer 菜单。
- 现有数据库通过增量列迁移兼容，无破坏性数据转换。

## Acceptance Criteria

- [x] 每个 Provider 可将系统渠道或一个启用的 CodeM 渠道设为默认，且 CodeM 默认唯一。
- [x] 默认 CodeM 渠道停用或删除后自动回到系统渠道，不自动选择其他 CodeM 渠道。
- [x] 新任务、新草稿和新自动化继承 Provider 默认渠道，已有会话保持原选择。
- [x] 设置页统一展示系统与 CodeM 渠道，系统详情只读，删除位于左侧 CodeM 渠道项并二次确认。
- [x] 渠道列表和 Composer 使用厂商图标；菜单包含可直达当前 Provider 渠道管理的入口。
- [x] 模型列表地址不再出现在前端，编辑旧配置不会清空已有值。
- [x] 模型菜单长文案按紧凑格式展示，超长内容可查看完整信息。

## Verification Commands

- `cargo test agent_channels::tests --manifest-path src-tauri/Cargo.toml`
- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record

- 2026-07-18T06:43:44.904Z 完成 Agent 默认渠道前端贯通与设置页重构：系统/CodeM 可分别设默认，Composer、新任务、自动化继承 Provider 默认，已有会话保持持久化选择；渠道列表统一展示、厂商图标、API/模型预览、管理入口和二次删除确认。补充无效/停用/跨 Agent 默认渠道拒绝测试。
- 2026-07-18T06:07:29.282Z 完成 Agent 默认渠道后端语义：新增 system/CodeM 统一设默认 API、bootstrap defaultChannelIds、template_id 兼容迁移；停用或删除默认渠道回到 system。Rust agent_channels 定向测试 7/7 通过。

- 2026-07-18T05:59:14.614Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T06:43:49.680Z `npm run typecheck && npm run build && git diff --check`: typecheck 通过；生产构建通过，仅有既有 chunk/dynamic import 警告；diff check 通过

- 2026-07-18T06:43:46.804Z `node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/provider-template-search.test.ts`: 16 passed; 0 failed
- 2026-07-18T06:43:45.724Z `cargo test agent_channels::tests --manifest-path src-tauri/Cargo.toml`: 7 passed; 0 failed

## Completion Summary
- 2026-07-18T06:44:00.832Z 完成 Agent 默认渠道与渠道管理体验：系统渠道和 CodeM 渠道统一展示并可分别设为默认；新任务、新草稿和自动化继承 Provider 默认；已有会话保持原选择；设置页提供只读系统详情、厂商图标、API/模型预览、管理入口和安全删除确认；补齐默认渠道边界测试并通过前端、后端和生产构建验证。

## Follow-ups

- 无。
