# Task: Agent Mux 调用方标签

## Background

外部 Skill 调用记录当前统一显示为 External Skill，无法区分由 Codex、Claude Code 或 OpenCode 等哪个主 Agent 发起；会话名称又不应要求主 Agent 额外识别或推测。

## Objective

外部 Skill 调用记录展示主 Agent 类型，不采集会话名称

## Scope

In scope:

- CLI 增加可选调用方 Agent 标签并写入现有 caller 字段。
- 生成的 Skill 明确只传 Agent 名称，不传会话名称。
- 旧 Skill 未传标签时保持兼容。

Out of scope:

- 主 Agent 会话名称、会话 ID 和用户身份采集。
- 将调用方标签作为可信身份或权限依据。

## Impact

监控页现有调用方位置会显示 OpenAI Codex、Claude Code、OpenCode 等标签；数据库结构不变。

## Acceptance Criteria

- [x] 外部调用可通过 `--caller` 记录主 Agent 类型。
- [x] 未传参数时使用“外部调用”。
- [x] 空标签和超过 64 个字符的标签被拒绝。
- [x] Skill 明确禁止填写或推测会话名称。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `node --import tsx --test src/lib/agent-mux-ui.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-08-05T12:05:30.277Z CLI 新增可选 --caller 标签并复用现有 caller 字段；生成 Skill 只要求传主 Agent 名称，明确禁止填写或推测会话名称；旧调用默认显示外部调用。

- 2026-08-05T12:00:25.789Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T12:05:32.982Z `cargo build --bin codem-agent-mux and runtime restart`: pass: runtime restarted on port 61939
- 2026-08-05T12:05:32.291Z `npm run typecheck`: pass

- 2026-08-05T12:05:31.605Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: pass: 8/8
- 2026-08-05T12:05:30.939Z `cargo test --bin codem-agent-mux`: pass: 3/3

## Completion Summary
- 2026-08-05T12:05:44.666Z Agent Mux 外部调用支持记录主 Agent 类型，兼容旧 Skill，不采集会话名称；CLI、测试、类型检查和开发 Runtime 已验证。

## Follow-ups

- 已安装的 codem-agent-mux Skill 需要在 Agent Hub 中点击更新后才会带上调用方标签。
