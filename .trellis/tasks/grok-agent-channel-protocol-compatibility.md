# Task: 完善 Grok 渠道协议兼容提示

## Background

用户使用 Grok Build + CodeM 自定义渠道实测发现：同一上游选择 OpenAI Chat 可以正常运行，选择 OpenAI Responses 时 ACP 仅返回笼统的“Provider 拒绝了请求”。本机 Grok Build 0.2.99 实际识别 `chat_completions`、`responses`、`messages` 三种后端，因此问题不是 Grok Build 完全不支持 Responses，而是具体上游没有实现所选协议。

同时核对发现，OpenCode 的 OpenAI 兼容运行时使用 `@ai-sdk/openai-compatible`，当前即使保存为 OpenAI Responses，实际仍按 Chat Completions 运行，设置界面暴露该选项会形成错误预期。

## Objective

让 Grok 自定义渠道默认使用 OpenAI Chat，并在 Responses 上游不兼容时给出明确可操作提示

## Scope

In scope:

- 建立 Agent 渠道接口类型矩阵：Claude Code 仅 Anthropic，Codex 支持 Responses/Chat，Grok 支持 Chat/Responses/Anthropic，OpenCode 支持 Chat/Anthropic。
- Grok 新建自定义渠道默认选择 OpenAI Chat，同时保留 Grok Build 确实支持的 Responses 和 Anthropic 高级选项。
- 界面提示用户接口类型必须与上游真实端点一致，普通 OpenAI 兼容渠道优先选择 Chat。
- 将 OpenCode 历史 `openai_responses` 渠道迁移为真实运行协议 `openai_chat`。
- 将 ACP RPC 错误文案从容易误解为权限问题的“拒绝请求”调整为请求失败提示，指出需要检查接口类型、地址、模型或认证。
- 补充前端协议矩阵、后端校验与历史迁移回归测试。

Out of scope:

- 不修改用户的系统 Grok、OpenCode 或 CC Switch 配置。
- 不自动把 Grok Responses 渠道改成 Chat，避免覆盖确实支持 Responses 的自定义上游。
- 不探测或保存用户 API Key，不把上游原始错误或敏感响应直接暴露到界面。
- 不修改普通聊天供应商协议矩阵。

## Impact

- Frontend：`AgentChannelSettings` 的默认接口顺序、可选矩阵和提示文案。
- Backend：Agent 渠道协议校验、OpenCode 历史协议迁移和 ACP 公共错误文案。
- Persistence：仅将行为等价但标记错误的 OpenCode `openai_responses` 历史记录更新为 `openai_chat`；Grok 数据不迁移。

## Acceptance Criteria

- [x] 新建 Grok 渠道默认选中 OpenAI Chat，仍可手工选择 Responses 或 Anthropic。
- [x] OpenCode 不再显示或接受 OpenAI Responses，新建渠道默认选择 OpenAI Chat。
- [x] 旧 OpenCode Responses 渠道自动迁移为 Chat，原渠道、密钥、模型和默认状态不变。
- [x] Claude Code、Codex 的接口类型行为不回归。
- [x] Grok/ACP 上游请求失败时不再显示成权限语义，并给出可操作的配置检查方向。
- [x] 前端定向测试、Rust Agent 渠道测试、完整类型检查和格式检查通过。

## Verification Commands

- `node --import tsx --test src/lib/provider-template-search.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_channels::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_run::tests`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-16T12:47:20.238Z 建立 Agent 渠道协议矩阵：Grok 默认 OpenAI Chat 且保留三种后端；OpenCode 收口为 Chat/Anthropic 并迁移旧 Responses 标记；ACP RPC 公共错误改为渠道配置检查提示。

- 2026-07-16T12:42:31.046Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T12:50:36.454Z `桌面开发版启动与 /api/agents/channels/bootstrap`: 通过：Web 5173、Rust backend 3001 正常监听；首页 200；当前 Grok/OpenCode 渠道协议分别为 openai_chat/anthropic_messages
- 2026-07-16T12:48:41.447Z `npm run typecheck；cargo fmt --check；git diff --check`: 全部通过，仅存在工作区既有 LF/CRLF 提示

- 2026-07-16T12:48:41.072Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 141 项、desktop 9 项，1 项真实 Grok 登录 smoke test按设计忽略
- 2026-07-16T12:48:40.696Z `node --import tsx --test src/lib/provider-template-search.test.ts src/lib/agent-run-events.test.ts`: 通过：13/13，Agent 协议矩阵与 OpenCode 思考事件回归均正常

## Completion Summary
- 2026-07-16T12:50:36.819Z 完善 Agent 渠道协议兼容：Grok 默认使用 OpenAI Chat 并保留明确支持的高级协议；OpenCode 收口真实 Chat/Anthropic 能力并迁移旧标记；ACP 错误改为可操作的渠道配置提示，完整测试与桌面启动验证通过。

## Follow-ups

- 对新增厂商模板继续以其真实公开端点为准；连接测试只能验证当前渠道，不替代厂商能力矩阵。
