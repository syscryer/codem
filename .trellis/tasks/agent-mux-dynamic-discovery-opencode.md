# Task: Agent Mux 动态发现与 OpenCode 调用

## Background

Agent Mux Skill 当前同时提供 `agents --json` 实时发现命令和安装时生成的“当前可用配置”快照。快照会随着用户新增、删除、启停或修改 Profile 而过期，容易诱导外部 Agent 调用不存在或已禁用的 profileId。另一方面，OpenCode Profile 已能在 Agent Mux 中配置、检测并被 `agents --json` 发现为 available，但 `codem-agent-mux invoke` 的 provider 映射未包含 OpenCode，实际调用会返回“当前 Agent 暂不支持独立运行”，发现状态与执行能力不一致。

## Objective

移除 Skill 中写死的配置快照，使用 CLI 实时发现可调用配置，并补齐 OpenCode Agent Mux 独立调用闭环

## Scope

In scope:

- 生成的 Agent Mux Skill 只描述实时发现协议，不嵌入任何 Agent/Profile 配置快照。
- 保留并验证 `codem-agent-mux agents --json` 作为可调用配置的唯一实时发现入口。
- `codem-agent-mux invoke` 支持调用已检测可用的 OpenCode Profile，复用现有通用 Agent Runtime、ACP 事件流、取消与运行记录。
- Agent 运行不再被 ACP 固定 5 分钟总超时中断；仍可由用户取消，并保留进程、协议和传输错误终态。
- 取消只结束当前 turn，必须保留可写的 ACP 热会话供下一轮复用；不得用关闭 Provider 子进程或热会话作为普通取消实现。
- Mux 收到后端错误终态时保留真实错误摘要并以非零退出码结束。
- Provider 返回完成终态但没有公开输出时不得静默成功，Mux 将其记录为真实失败并返回非零退出码。
- 对动态 Skill 内容、OpenCode provider 映射与真实调用补充回归验证。

Out of scope:

- 不新增 Agent Mux 配置字段、数据库表或 UI 页面。
- 不改变 OpenCode 自身登录、渠道、模型目录或插件管理。
- 不把不可运行或检测失败的 Profile 暴露为可调用状态。
- 不调整 Claude Code 的独立运行边界。

## Impact

- Runtime CLI: `src-tauri/src/bin/codem-agent-mux.rs`
- Skill source: `src/components/AgentMuxPrototype.tsx` 及 Skill 同步链路
- Agent runtime contract: `src-tauri/src/agent_run.rs`
- Installed Skill: `C:\Users\syscr\.codex\skills\codem-agent-mux\SKILL.md`（验证通过后同步）

## Acceptance Criteria

- [ ] 新生成/更新的 Skill 不包含 profileId、模型、昵称等配置快照，并明确每次调用前执行 `agents --json`。
- [ ] `agents --json` 返回当前数据库中 status=available 的实时 Profile 信息，新增或变更配置无需重新生成 Skill 才能被发现。
- [ ] 旺财（OpenCode/GLM-5.2）可通过 `codem-agent-mux invoke --profile ...` 完成只读代码审查，并在运行监控中形成真实终态与输出。
- [ ] 超过 5 分钟的 ACP Agent 任务不会被固定总超时中断，真实错误不会被部分输出覆盖，失败调用返回非零退出码。
- [ ] 不支持独立运行的 Agent 不得仅因存在 Profile 而被误报为可调用。
- [ ] Agent Mux CLI、Agent Runtime、类型检查和生产构建通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux --lib`
- `npm run typecheck`
- `npm run build`
- `cargo build --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `codem-agent-mux agents --json ...` 与旺财真实 `invoke` smoke
- `git diff --check`

## Implementation Record
- 2026-08-11T09:02:29.543Z 复核旺财审查：不采纳新增空闲/任务看门狗，避免重新引入执行时长限制；不采纳 cancelled 空输出应失败。曾尝试以关闭 ACP Runtime 强制取消，但用户指出普通取消只应结束当前 turn 并保留热会话，已立即完整撤回 src-tauri/src/agent_run.rs 改动，并将热会话保留边界写入任务。

- 2026-08-11T08:31:23.582Z 真实 OpenCode Mux 审查于 5 分钟后失败；SQLite 事件确认终态错误为 ACP Provider 响应超时：session/prompt。将固定 5 分钟总超时移除，代理运行时长不设上限，保留手动取消、进程退出和协议错误终态。
- 2026-08-11T08:17:09.836Z 确认动态发现契约：agents --json 仅输出 CLI 支持且 status=available 的 Agent/Profile 目录，不返回 metrics/runs；Skill 不再嵌入任何配置快照。OpenCode 复用现有 /api/agents/run ACP Runtime，并同步开放 CodeM 内运行下拉。

- 2026-08-11T08:10:14.727Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T09:03:50.998Z `installed codem-agent-mux SKILL.md audit`: 已删除当前可用配置、具体 profileId/model/nickname 快照；agents --json 为唯一可信来源

- 2026-08-11T09:03:50.320Z `codem-agent-mux agents --json + OpenCode invoke smoke/review`: 动态目录仅返回当前可调用配置且无 runs/metrics；旺财短调用返回 OPENCODE_MUX_OK，审查调用运行 06:38 后返回公开结论，未触发旧 5 分钟超时
- 2026-08-11T09:03:49.625Z `node --import tsx --test src/lib/agent-mux-ui.test.ts && npm run typecheck && npm run build`: Agent Mux UI 20 passed；TypeScript 通过；Vite 生产构建通过

- 2026-08-11T09:03:48.986Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`: 20 passed；覆盖动态目录、OpenCode 路由、真实错误摘要与空完成结果失败
- 2026-08-11T09:03:48.319Z `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 479 passed, 1 ignored；撤回关闭热会话误改后再次通过

## Completion Summary
- 2026-08-11T09:04:04.232Z Agent Mux Skill 已改为通过 agents --json 实时发现当前可调用配置，不再嵌入配置快照；CLI 目录仅返回支持且 available 的 Agent/Profile；OpenCode 已接通共享 ACP Runtime；移除 Agent turn 固定 5 分钟总超时且不增加时长/轮次限制；错误终态和完成但无公开输出不再静默成功。旺财真实调用与超过 5 分钟审查通过。取消仍只结束当前 turn 并保留热会话。

## Follow-ups

- 无。
