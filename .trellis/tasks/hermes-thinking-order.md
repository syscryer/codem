# Task: 修复 Hermes 思考事件顺序

## Background

Hermes Gateway 会在 assistant 正文流结束后发送 `reasoning.available`。该事件是对当前 assistant 内容的最多 500 字回填；Hermes Desktop 在当前消息已有正文时会忽略它。CodeM 当前无条件映射为 `thinking-delta`，导致最终正文之后出现重复的 Thinking。

## Objective

保证 Hermes Thinking 与最终正文按公开协议语义展示，并在实时 timeline 与 SQLite 恢复后保持一致。

## Scope

In scope:

- 复用 Composer 现有 Brain 控件，为 Hermes 展示官方支持的思考级别。
- Hermes 模型能力目录声明 `none / minimal / low / medium / high / xhigh / max / ultra`，默认 `medium`。
- 新会话与已有会话均通过通用 `reasoning_effort` 链路传递 Hermes 思考级别。
- 在 Hermes Driver/Runtime 层识别并忽略已有正文后的 `reasoning.available` 回填。
- 保留真正的 `reasoning.delta` 公开思考事件。
- 确保只有 Thinking/工具事件、最终正文仅由 `done.result` 提供时，正文仍进入 timeline。
- 补充 Hermes 事件顺序与通用终态收口测试。

Out of scope:

- 不隐藏真实 `reasoning.delta`。
- 不按正文内容猜测 Thinking。
- 不修改聊天输入框、自适应布局或其他 Hermes 设置界面。
- 不修改 Hermes 上游代码。

## Impact

- `src-tauri/src/agent_run.rs`：Hermes 事件映射与运行时状态。
- `src/hooks/useClaudeRun.ts` 或共享 reducer：`done.result` 的正文补齐规则。
- 对应 Rust 与 TypeScript 回归测试。

## Acceptance Criteria

- [ ] `message.delta -> reasoning.available -> message.complete` 不产生末尾重复 Thinking。
- [ ] `reasoning.delta -> message.delta -> message.complete` 保持 Thinking 在正文之前。
- [ ] Hermes 选中模型时显示现有 Brain 控件，并提供官方支持的全部思考级别，默认 `medium`。
- [ ] Hermes 新建与续接会话接受 `reasoning_effort`，刷新后线程选择保持不变。
- [ ] 只有 Thinking/工具 item 且 `message.complete.text` 有正文时，正文仍追加到末尾。
- [ ] 完成后的 timeline 持久化和刷新恢复保持 item 类型与顺序。
- [ ] Hermes 定向测试、前端定向测试、typecheck、build、Rust format/test 与 onboarding gate 通过。
- [ ] 重启相关服务并通过真实 Hermes 会话验证。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml hermes --lib`
- `node --import tsx --test <focused tests>`
- `npm run typecheck`
- `npm run build`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `git diff --check`

## Implementation Record
- 2026-08-10T09:54:31.951Z Hermes 真实验收完成：重启 desktop:dev 后，Agent Mux 健康检查 200；MiniMax-M3 的 none/medium/high 三档请求均成功。high 返回公开 thinking-delta，顺序为 Thinking -> 正文 -> 唯一 done；none 不产生 Thinking，medium 本轮仅返回思考阶段状态。Playwright 验证 Brain 菜单八档齐全，High 选择可持久化，真实 UI 发送显示 Thinking 165 chars，刷新后 Thinking、正文和 High 均恢复，浏览器控制台无错误。

- 2026-08-10T09:01:49.014Z 已接通 Hermes 官方 reasoning effort 能力目录：系统渠道使用配置默认模型，自定义渠道沿用渠道模型；Composer 复用现有 Brain 控件，后端线程校验接受 Hermes。
- 2026-08-10T08:17:35.356Z Hermes Provider 图标增加 1.18 倍光学缩放，仅改变图标自身视觉面积，不改变 17px 布局尺寸、列表行高或其他 Provider；浏览器实页截图确认与同层级图标大小一致。

- 2026-08-10T07:43:26.441Z 按用户最新参考图替换 Hermes Provider 图标：仅保留上方女孩头像，移除图片内 Hermes Agent 文字，并收紧位图边界使 17px 列表图标与其他 Provider 视觉尺寸一致；未修改聊天输入框自适应逻辑。
- 2026-08-10T06:37:43.329Z 已对照 Hermes 上游确认：thinking.delta 是 spinner 状态文案，reasoning.available 是 assistant 内容的最多 500 字回填；仅 reasoning.delta 属于可展示的公开思考。已在 Hermes 映射层忽略前两者，并修正 done 仅有 Thinking/工具 item 时补齐最终正文。

- 2026-08-10T06:22:35.830Z Task created by Trellis automation.
- 2026-08-10: 对照 Hermes 上游源码确认 `reasoning.available` 是 assistant 内容的回填，Hermes Desktop 在当前消息已有正文时忽略该事件。

## Verification Results
- 2026-08-10T09:54:35.927Z `Hermes MiniMax-M3 none/medium/high live API smoke`: 三档均 200 且唯一 done；high 返回公开 thinking-delta

- 2026-08-10T09:54:35.259Z `Playwright Hermes UI real-run acceptance`: 八档菜单、High 持久化、Thinking 先于正文、刷新恢复、控制台无错误均通过
- 2026-08-10T09:54:34.588Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: 72 项前端门禁及 Rust、typecheck、build 全部通过

- 2026-08-10T09:54:33.954Z `cargo test --manifest-path src-tauri/Cargo.toml hermes --lib`: 15/15 通过
- 2026-08-10T09:54:33.240Z `node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-provider-management-ui.test.ts src/lib/multi-provider-chat-routing.test.ts`: 45/45 通过

- 2026-08-10T09:54:32.579Z `npm run typecheck`: 通过
- 2026-08-10T08:17:51.927Z `npm run typecheck`: 通过；Hermes 图标样式无 TypeScript 回归。

- 2026-08-10T08:17:51.925Z `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-provider-onboarding-contract.test.ts src/lib/agent-mux-ui.test.ts`: 38/38 通过。
- 2026-08-10T07:43:26.512Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-10T09:54:55.007Z Hermes 思考能力实现与真实验收完成：复用 Composer Brain，支持 none/minimal/low/medium/high/xhigh/max/ultra，默认 medium；新建、续接、更新线程统一传递 reasoning_effort；Hermes reasoning.delta 正确映射 Thinking，忽略 reasoning.available 回填，done 仅在需要时补正文。完成 typecheck、45 项定向前端测试、72 项 onboarding gate、15 项 Hermes Rust 测试、cargo fmt、build、diff check；重启 desktop:dev 并通过 Agent Mux 健康检查和 MiniMax-M3 三档真实 API；Playwright 验收八档菜单、High 持久化、Thinking timeline 和刷新恢复。未修改聊天输入框自适应逻辑。

## Follow-ups

- None.
