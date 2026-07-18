# Task: 修复 Grok 渠道会话隔离

## Background

Grok Build 的 ACP 会话保存在按渠道隔离的 `GROK_HOME` 中。旧实现切换渠道后仍尝试恢复旧 session，导致 `Path not found`；改为新建 session 后虽然能继续发送，但新 session 看不到 CodeM 当前线程已有历史，表现为切换渠道后失忆。

## Objective

Grok 渠道使用按渠道隔离的运行目录，切换渠道时必须创建新底层 session；Claude/Codex 渠道恢复行为保持不变。

## Scope

In scope:

- Grok 切换渠道后重启底层 ACP runtime，并创建新 session。
- 新 session 首轮一次性注入 CodeM 已完成轮次的用户文本和最终回答。
- 记录每个线程最后真正启动成功的 runtime 渠道，渠道下拉切换本身不重启 Agent。
- 限制续接上下文长度，不包含思考文本、工具载荷或附件二进制数据。
- 保持 Claude Code、Codex、OpenCode 和 Grok 同渠道热会话行为不变。

Out of scope:

- 不跨 Agent Provider 切换现有线程。
- 不复制 Grok 渠道目录中的底层 session 文件。
- 不向新渠道迁移隐藏思考、完整工具输出或附件原文。

## Impact

- `src/hooks/useAgentRun.ts`
- `src/lib/agent-channel-selection.ts`
- `src/lib/agent-channel-continuity.ts`
- `src-tauri/src/agent_run.rs`
- 相关前端和 Rust 定向测试

## Acceptance Criteria

- [ ] Grok 同渠道连续发送仍复用原热 session。
- [ ] Grok 切换渠道后在下一次发送时新建 session，不再出现旧渠道 `Path not found`。
- [ ] 新 session 能依据当前 CodeM 线程的已完成对话继续回答。
- [ ] 续接上下文有长度上限，并排除思考、工具载荷和附件二进制数据。
- [ ] Claude Code、Codex 和 OpenCode 的原有 session 行为不变。

## Verification Commands

- `npx tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-channel-continuity.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs`
- `git diff --check`

## Implementation Record

- 2026-07-18T10:33:48.168Z 修复渠道切换状态同步：本地清理旧 runtime 指纹，并在 Grok 渠道切换瞬间保留真实运行渠道，避免下一次发送误复用旧 session
- 2026-07-18T09:46:52.392Z 确认 Grok 跨渠道切换需要一次性注入已完成对话上下文，保持同渠道热会话不变

- 2026-07-18T09:33:07.953Z Task created by Trellis automation.
- Grok 渠道切换时不再向隔离的运行目录恢复旧 session；ACP 恢复失败也会回落新 session。
- 增加 runtime 渠道索引，以 session 事件作为“新渠道已真正启动”的确认点。
- 新增受限的会话续接上下文，仅包含已完成轮次的用户文本和最终回答。

## Verification Results
- 2026-07-18T10:38:10.273Z `Playwright 桌面开发版跨渠道验证`: 切换 Grok 渠道后请求省略旧 sessionId、注入 conversationContext，续问测试标记成功恢复

- 2026-07-18T10:38:08.863Z `rustfmt --edition 2021 --check src-tauri/src/agent_run.rs && git diff --check`: Rust 格式检查与 diff 空白检查通过
- 2026-07-18T10:38:06.807Z `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`: 24 个 Rust agent_run 测试通过

- 2026-07-18T10:38:05.737Z `npx tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-channel-continuity.test.ts`: 13 个渠道选择与上下文续接测试全部通过
- 2026-07-18T10:38:04.838Z `npm run typecheck`: TypeScript 类型检查通过

## Completion Summary
- 2026-07-18T10:38:20.157Z 完成 Grok 跨渠道会话续接：渠道切换时保留旧 runtime 渠道事实，发送时按渠道创建新 ACP session，并一次性注入已完成对话上下文；同渠道热会话和其他 Agent 行为保持不变。已通过 TypeScript、前端定向测试、Rust agent_run 测试、格式检查及桌面端真实跨渠道验证。

## Follow-ups

- 如后续 ACP 协议提供标准 session fork/import 能力，可替换文本续接方案。
- 2026-07-18 后续任务 `grok-shared-session` 已将 Grok 改为线程级共享 `GROK_HOME`，同一线程切换供应商时直接恢复原 ACP session；本任务中的“跨渠道新建 session + 文本续接”仅保留为历史实现记录。
