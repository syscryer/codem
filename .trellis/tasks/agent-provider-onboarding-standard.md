# Task: 标准化 Agent Provider 接入

## Background

CodeM 已接入 Claude Code、Grok Build、OpenAI Codex、OpenCode 与 Pi Agent，但新增 Provider 时仍需在多处静态名单和 Provider 专属分支中手工补齐。过去接入中曾出现主运行可用、对话产物、文件链接、上下文、热会话状态、自动化或设置页未同步适配的问题。

当前回填检查再次发现：Pi 已进入通用运行链，但工作区热会话状态与自动化 Provider 校验仍未覆盖 Pi。需要把接入要求沉淀为仓库规范、可执行门禁和可复用 Skill，避免只依赖开发者记忆。

## Objective

建立 CodeM Agent 接入规范、可执行合同门禁和 codem-agent-onboarding Skill，统一覆盖运行、对话产物、链接、上下文、状态、持久化与测试范围

## Scope

In scope:

- 新增 `openspec/agent-provider-onboarding.md`，定义 Provider/Driver/Runtime/Event、输入、产物、链接、上下文、状态、持久化、安全和验收合同。
- 增加前端 Provider 静态元数据唯一入口，收口运行路由、显示名、协议标签和高风险 UI 列表。
- 增加后端受支持 Provider ID 共享校验，供自动化等通用功能复用。
- 增加可执行接入门禁，覆盖 Provider 元数据、运行路由、设置、图标、状态与关键对话能力。
- 回填修复门禁发现的 Pi 热会话状态和自动化校验漏项。
- 新增仓库内唯一源 `skills/codem-agent-onboarding/`，并在验证后同步到 Codex 与 Claude Code 全局 Skill 目录。

Out of scope:

- 不实现动态加载第三方 Provider 插件。
- 不改造现有 Driver 协议或重写 Agent Runtime。
- 不为现有 Agent 补做协议本身不支持的能力。
- 不修改 Agent Mux 原型、全局下拉样式或其他现有未提交改动。
- 不执行真实 Agent 安装、登录或需要凭据的在线验收。

## Impact

- Frontend：Provider 静态元数据、通用路由、设置列表、Usage、工作区状态及合同测试。
- Backend：Provider ID 共享校验、自动化 Provider 校验及 Rust 回归测试。
- Docs/Process：OpenSpec、Trellis、仓库 Skill 与 Codex/CC 全局 Skill 同步。
- Persistence/API：不新增 schema，不改变现有 `AgentRunEvent` wire contract。

## Acceptance Criteria

- [x] OpenSpec 覆盖新增 Agent 的完整适配矩阵、能力分级、测试矩阵和生产门禁。
- [x] 前端高风险 Provider 列表从统一元数据派生，新增 Provider 时 TypeScript 类型检查能暴露遗漏。
- [x] 通用运行路由、工作区状态和协议显示包含 Pi，并对未知 Provider 保持明确回退。
- [x] 自动化接受所有当前 active Provider，并拒绝未知 Provider。
- [x] 合同测试覆盖 Provider 唯一性、路由、显示元数据、图标、状态、Markdown/文件产物现有测试入口。
- [x] `codem-agent-onboarding` Skill 有准确触发描述、简洁工作流、引用 OpenSpec、可运行检查脚本并通过 Skill 校验。
- [x] Skill 同步到 Codex 与 Claude Code 全局目录后内容一致。
- [x] 相关 TypeScript 测试、Rust 测试、typecheck、format 和 build 通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-onboarding-contract.test.ts src/lib/agent-provider-registry.test.ts src/lib/settings-api.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/markdown-link.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-context-prototype.test.ts src/lib/workspace-session-status.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_runtime::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml automation::tests`
- `npm run build`
- Skill `quick_validate.py` 与仓库检查脚本。

## Implementation Record
- 2026-08-07T15:16:02.106Z 本任务建立接入标准而非接入新的 Provider，因此未执行需要安装、登录或凭据的真实 CLI 验收；后续每个新 Provider 必须按 OpenSpec 单独记录该项证据。

- 2026-08-07T15:16:01.466Z 已新增合同测试与 codem-agent-onboarding Skill；Skill 只引用 OpenSpec，并通过检查脚本执行文档产物、链接、上下文、状态、类型、Rust 与构建门禁。已同步 Codex/Claude Code 全局目录且三份内容哈希一致。
- 2026-08-07T15:16:00.814Z 已完成前后端 Provider 共享门禁：前端静态元数据收口运行路由、显示名、协议、设置与 Usage；后端 active Provider 校验供自动化复用；回填 Pi 工作区热状态、自动化和默认 Agent 设置恢复漏项。

- 2026-08-07T14:57:02.047Z 已新增 Agent Provider 接入 OpenSpec：明确能力分级、统一事件、文档与链接、上下文与状态、持久化安全、产品适配面和真实 CLI 验收门禁。
- 2026-08-07T14:55:23.388Z 已确认范围：以 OpenSpec 为事实来源、合同测试为门禁、Skill 为执行向导；只回填门禁发现的 Pi 状态和自动化漏项，不建设动态插件系统。

- 2026-08-07T14:52:31.369Z Task created by Trellis automation.

## Verification Results

- 2026-08-07T15:16:16.832Z `skill-creator quick_validate.py and repository/Codex/Claude Skill content hash comparison`: pass
- 2026-08-07T15:16:16.199Z `python skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem: 68 TS tests, typecheck, cargo fmt, 11 runtime tests, 5 automation tests, npm build`: pass

## Completion Summary
- 2026-08-07T15:16:17.476Z Agent Provider 接入 OpenSpec、共享 Provider 门禁、Pi 漏项修复、合同测试和双端全局 Skill 已完成；自动化门禁全部通过，真实新 Provider CLI 验收留给具体接入任务。

## Follow-ups

- 后续新增真实 Provider 时，按 Skill 建立独立 Trellis 任务并完成 Provider 专属真实 CLI 验收。
- 仅在第三方 Provider 需要独立安装发布时，再评估动态插件系统。
