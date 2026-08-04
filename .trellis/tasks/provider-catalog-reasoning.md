# Task: 厂商目录与 DeepSeek 思考等级

## Background

Agent 渠道设置此前先按当前 Agent 的协议能力过滤模板，导致 OpenAI Codex 只显示少量支持 Responses 的厂商，用户无法确认完整厂商目录。同一厂商已有按渠道和接口类型聚合的界面，但目录层过滤破坏了这一结构。DeepSeek Responses 渠道发现的 `deepseek-v4-flash` 又没有携带思考能力，聊天输入区因此不显示思考等级。

## Objective

完整展示 Agent 厂商并按厂商聚合渠道，新增 OpenCode Go Chat/Responses 模板，补齐 DeepSeek V4 Flash Codex 思考等级并完成桌面验收

## Scope

In scope:

- 厂商下拉基于完整模板列表聚合，同一厂商只显示一次。
- 所有厂商保持可选，选中后展示其现有渠道和接口；当前运行支持仍由 Agent 后端校验。
- 选中兼容厂商后，继续在厂商内部选择渠道和接口类型。
- 新增 OpenCode Go 厂商，同一渠道提供 OpenAI Chat 与 OpenAI Responses 模板。
- 为官方 DeepSeek Responses 的 `deepseek-v4-flash` 补充可选思考等级及默认值。
- 补充前后端回归测试，并在桌面开发模式中验收。

Out of scope:

- 不静态维护 OpenCode Go 的完整模型清单，模型仍由上游接口动态发现。
- 不宣称所有 OpenCode Go 模型都支持 Responses，具体兼容性以上游为准。
- 不修改其他 Agent 的协议矩阵或既有渠道数据。

## Impact

- Frontend: `src/components/settings/AgentChannelSettings.tsx`、模板搜索与模型选择 helper/test。
- Backend: `src-tauri/src/ordinary_chat/provider.rs`、`src-tauri/src/agent_channels.rs` 的模板和模型能力归一化。
- Runtime contract: 渠道模型 `capabilities` 继续使用现有字段，不新增 API 字段。

## Acceptance Criteria

- [ ] OpenAI Codex 厂商下拉展示完整厂商目录，而不是只显示 Responses 厂商。
- [ ] 同一厂商只显示一次，所有厂商保持可选，并展示厂商现有渠道和接口类型。
- [ ] DeepSeek 和 OpenCode Go 在 Codex 下可选，OpenCode Go 内可见 Chat/Responses 接口模板。
- [ ] 官方 DeepSeek Responses 的 `deepseek-v4-flash` 在聊天输入区显示合法思考等级，并能传入 Codex 运行请求。
- [ ] 相关 Node/Rust 测试及 TypeScript 类型检查通过。
- [ ] 桌面开发模式重启后，通过实际界面确认厂商目录和思考等级。

## Verification Commands

- `node --test --import tsx src/lib/provider-template-search.test.ts src/lib/agent-channel-selection.test.ts src/lib/agent-model-selection.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml provider_templates`
- `cargo test --manifest-path src-tauri/Cargo.toml deepseek`
- Playwright 验收 `http://127.0.0.1:5174`

## Implementation Record

- 2026-08-04T09:50:54.018Z 用户确认当前所有厂商保持可选，不做静态禁用；CC Switch 路由能力和无 Node/npm 首装方案留作后续独立任务。OpenCode Go 已接入官方 GO 图标。
- 2026-08-04T08:44:48.922Z 已将厂商目录改为完整模板聚合，不兼容厂商置灰；新增 OpenCode Go Chat/Responses；按 DeepSeek 官方 Codex 目录为 V4 Flash 补充 low/high/max，默认 high。

- 2026-08-04T08:27:09.294Z Task created by Trellis automation.

## Verification Results
- 2026-08-04T09:50:57.618Z `npm run package:doctor && npm run package:win`: pass: NSIS and MSI generated

- 2026-08-04T09:50:56.906Z `Playwright Codex 厂商目录与 OpenCode Go`: pass: 19 vendors clickable, GO icon, Chat/Responses, 0 console errors/warnings
- 2026-08-04T09:50:56.183Z `cargo test --manifest-path src-tauri/Cargo.toml curated_templates_exclude_partner_marketplace_entries && cargo test --manifest-path src-tauri/Cargo.toml official_deepseek`: pass: 3/3

- 2026-08-04T09:50:55.467Z `node --test --import tsx src/lib/provider-template-search.test.ts src/lib/agent-channel-selection.test.ts src/lib/agent-model-selection.test.ts src/lib/settings-api.test.ts`: pass: 37/37
- 2026-08-04T09:50:54.721Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-04T09:51:21.300Z 完成厂商目录聚合与全量可选、OpenCode Go Chat/Responses 和 GO 图标、DeepSeek V4 Flash low/high/max 能力补齐；前后端测试、桌面 UI 与 Windows NSIS/MSI 打包通过。CC Switch 路由移植及无 Node/npm 首装方案留待后续。

## Follow-ups

- OpenCode Go 的 Responses 模型兼容范围可能随上游变化，后续如上游提供稳定能力字段再改为动态标识。
