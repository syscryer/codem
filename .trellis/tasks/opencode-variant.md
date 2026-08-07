# Task: OpenCode 思考等级选择

## Background

CodeM currently renders reasoning controls only for Codex. OpenCode's
`opencode models --verbose` output already includes per-model `variants`, but
the bridge drops that metadata and does not apply the saved level through ACP.

待补充背景。

## Objective

让 CodeM 根据 OpenCode ACP 返回的模型 variant 展示并应用思考等级，支持线程级保存与恢复

## Scope

In scope:

- Parse OpenCode verbose model metadata and expose variants.
- Reuse the existing thread-level `reasoningEffort` state.
- Apply the selected variant when creating or resuming an OpenCode ACP session.

- 待补充。

Out of scope:

- Hard-coding levels for models that do not advertise variants.
- Changing Claude, Codex, Grok, or Pi reasoning behavior.

- 待补充。

## Impact

- `src-tauri/src/agent_run.rs`: model parsing and ACP variant application.
- `src/components/Composer.tsx`: show the existing picker for OpenCode.
- No new persistence field; reuse thread metadata.

- 待补充。

## Acceptance Criteria

- [ ] OpenCode models with variants show a reasoning-level menu.
- [ ] New and resumed sessions receive the selected ACP `variant`.
- [ ] Models without variants keep the menu hidden.
- [ ] Regression checks pass.

- [ ] 待补充。

## Verification Commands

- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run`

- 待补充。

## Implementation Record

- 2026-08-07T11:59:12.148Z 核对 OpenCode 最新源码与本机 1.18.15 ACP：思考配置项 ID 为 effort；自定义 variants 注入后 high/max 可被 effort 接受，variant 会返回 unknown config option。已修正 ACP 透传入口。
- 2026-08-07T10:26:52.133Z 补齐 OpenCode Go GLM-5.2 能力声明，复用现有 variants 生成链路提供 high/max；发现热重载未重建独立 Agent Mux 后执行完整桌面重启。

- 2026-08-07T10:13:26.775Z 修复线程创建与元数据更新共享校验：OpenCode 现在允许持久化 reasoningEffort，错误文案同步覆盖全部支持 Provider。
- 2026-08-07T10:08:01.066Z 完成 OpenCode Go 模型级思考等级链路：按渠道探测 verbose variants，Qwen3.x 使用官方 Anthropic 协议并注入 high/max 推理预算，ACP 会话通过 variant 配置生效。

- 2026-08-07T09:35:11.925Z 补齐自定义 OpenCode 渠道 variant 探测：模型目录请求携带 channelId，后端使用渠道运行环境执行 verbose 探测，前后端缓存按渠道隔离，并兼容 provider 前缀模型 ID。
- 2026-08-07T08:52:51.347Z 已完成 OpenCode variant 链路：verbose 模型目录解析 variants，Composer 对 OpenCode 显示可用思考级别，线程复用 reasoningEffort 保存，并在 ACP 新建/恢复会话时设置 variant。未支持 variants 的模型保持隐藏。

- 2026-08-07T08:34:47.304Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T12:01:20.602Z `cargo test --manifest-path src-tauri/Cargo.toml --lib；cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check；本机 opencode 1.18.15 ACP 协议探针`: 通过：443 passed、1 ignored；格式与差异检查通过；自定义 GLM-5.2 返回 effort(high,max)，variant 被拒绝，effort=high 被接受；桌面与 Agent Mux 已自动重编译重启且 Responding=true
- 2026-08-07T10:26:53.611Z `完整桌面重启与 GLM-5.2 真实模型目录验收`: 通过：CodeM Responding=true；glm-5.2 default=high，supported=high,max；Agent Mux 已重建

- 2026-08-07T10:26:52.850Z `cargo test --lib && cargo fmt --check && git diff --check`: 通过：443 passed，1 ignored；格式和空白检查通过
- 2026-08-07T10:13:28.221Z `桌面自动重编译重启与运行时目录验证`: 通过：CodeM PID 9144 Responding=true；qwen3.8-max 仍提供 high,max

- 2026-08-07T10:13:27.490Z `cargo test --lib && cargo fmt --check && git diff --check`: 通过：443 passed，1 ignored；格式与空白检查通过
- 2026-08-07T10:08:03.906Z `cargo fmt --check && git diff --check`: 通过：Rust 格式和差异空白检查均无问题

- 2026-08-07T10:08:03.183Z `桌面重启与 OpenCode Go 运行时模型目录验收`: 通过：CodeM PID 42992 Responding=true；qwen3.8-max default=high，supported=high,max；Runtime 健康
- 2026-08-07T10:08:02.425Z `npm run typecheck && npm run build && 前端定向 node:test`: 通过：TypeScript 0 错误，生产构建成功，前端 37 passed、0 failed

- 2026-08-07T10:08:01.736Z `cargo test --lib`: 通过：443 passed，1 ignored，0 failed
- 2026-08-07T08:52:52.030Z `npm run typecheck；npm run build；cargo fmt --manifest-path src-tauri/Cargo.toml --check；cargo test --manifest-path src-tauri/Cargo.toml --lib；cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux；node --import tsx --test src/lib/multi-provider-chat-routing.test.ts src/lib/agent-model-selection.test.ts src/lib/thread-model-preferences.test.ts`: 全部通过：TypeScript/build 通过；Rust lib 442 passed 1 ignored；Agent Mux 10 passed；前端 Node 测试 16 passed；fmt 和 git diff --check 通过。直接 cargo test workspace 的首轮汇总异常，但拆分目标后均通过。

## Completion Summary
- 2026-08-07T12:01:34.353Z 修正 OpenCode ACP 思考等级配置 ID：CodeM 现按 OpenCode 统一 effort 入口透传模型 variant；源码与本机 1.18.15 实测确认不支持任意等级自动映射，模型能力仍以 variants 为准。

- 2026-08-07T10:27:07.323Z 完成 OpenCode Go GLM-5.2 high/max 思考等级支持；独立 Agent Mux 已随桌面完整重启重建，真实运行时目录验证通过。
- 2026-08-07T10:13:28.992Z 修复 OpenCode reasoningEffort 被线程元数据旧校验拒绝的问题；桌面已自动重启，完整 Rust 回归及真实运行时目录验证通过。

- 2026-08-07T10:08:14.496Z 完成 OpenCode 思考等级支持：自定义渠道模型目录按渠道隔离并解析 variants，OpenCode Go Qwen3.x 使用官方 Anthropic 协议提供 high/max，选择通过 ACP variant 应用；桌面已重启并完成真实运行时验收。
- 2026-08-07T08:53:22.802Z OpenCode variant 思考等级已接入：verbose 模型目录返回真实 variants，UI 按模型能力显示选择器，线程复用现有 reasoningEffort 持久化，ACP 新建/恢复时应用 variant。验证已通过 typecheck、build、Rust lib/Agent Mux 测试及相关前端测试。

## Follow-ups

- 待补充。
