# Task: 修复 OpenCode 通用思考等级能力

## Background

OpenCode Go 自定义渠道的思考等级由后端按少量模型 ID 补齐，前端又按
`deepseek-v4-flash` 名称单独猜测能力。两处来源不一致时，界面会允许选择
`high`，但运行时生成的 OpenCode 模型没有对应 variant，最终被 ACP 以
`effort not found` 拒绝。

## Objective

统一从模型声明生成与消费 OpenCode variants，移除模型白名单和前端猜测，并完成真实 ACP 验收

## Scope

In scope:

- OpenCode Go 模板对全部渠道模型统一声明已验证的 high/max variants。
- 任意其他 OpenCode 模型继续消费 verbose catalog 或模型 capabilities 中的真实声明。
- 移除前端按模型 ID 猜测思考等级的逻辑。
- 覆盖任意未来模型 ID、显式能力覆盖和无能力模型的回归测试。

Out of scope:

- 猜测非 OpenCode Go 第三方渠道的模型能力。
- 修改 Claude、Codex、Grok、Gemini、Pi 或 Hermes 的原生推理协议。

## Impact

- `src-tauri/src/agent_channels.rs`: 模板级能力与 OpenCode 运行配置 variants。
- `src/lib/agent-channel-selection.ts`: 前端只消费真实 catalog/capabilities。
- `src/lib/agent-channel-selection.test.ts`: 通用模型 ID 回归。

## Acceptance Criteria

- [x] OpenCode Go 中任意模型 ID 都提供 high/max，并可通过 ACP 切换。
- [x] 模型显式声明的 variants 优先于模板默认值。
- [x] 其他 OpenCode 渠道只展示实际声明的等级。
- [x] 前端不再按模型名称合成推理能力。
- [x] 定向测试、类型检查、Rust 格式和完整后端测试通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels`
- 本机 OpenCode 1.18.15 verbose catalog 与 ACP 实际切换探针

## Implementation Record

- 2026-08-12T03:13:32.208Z 实现完成：OpenCode Go 的 high/max 从模型 ID 白名单提升为已验证的模板级能力；前端移除 deepseek-v4-flash 名称猜测；任意其他 OpenCode 模型仍以 verbose catalog 或 capabilities 显式声明为准。桌面与 Agent Mux 已完整重启。
- 2026-08-12T03:00:07.877Z 根因确认：前端按 deepseek-v4-flash 名称合成 high，而 OpenCode 自定义运行时只为 Qwen3/GLM 白名单生成 variants，导致 UI 与 ACP 能力不一致。修复采用 OpenCode Go 模板级 high/max 声明，其他渠道继续依赖 verbose/capabilities，显式模型能力优先。

- 2026-08-12T02:53:56.532Z Task created by Trellis automation.

## Verification Results

- 2026-08-12T03:13:32.802Z `CodeM Agent onboarding gate；OpenCode 1.18.15 真实目录与 ACP 探针`: pass：onboarding gate 通过；DeepSeek、GPT-5.6 Luna、Kimi、Qwen、GLM 均返回 high/max；deepseek-v4-flash effort high/max 均被 ACP 接受
- 2026-08-12T03:13:32.489Z `node --import tsx --test src/lib/agent-channel-selection.test.ts；npm run typecheck；cargo fmt --check；cargo test --lib`: pass：前端 25/25；TypeScript 通过；Rust 481 passed、1 ignored；格式与差异检查通过

## Completion Summary
- 2026-08-12T03:13:59.248Z 完成 OpenCode 通用思考等级修复：OpenCode Go 按模板为全部模型提供 high/max，其他渠道按真实 variants/capabilities 驱动，移除前端模型名猜测；真实 DeepSeek ACP high/max 验收及完整门禁通过。

## Follow-ups

- 待补充。
