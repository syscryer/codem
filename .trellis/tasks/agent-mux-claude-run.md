# Task: Agent Mux 支持 Claude Code 独立运行

## Background

Agent Hub 实测（2026-08-19）发现"运行任务"入口无法发起 Claude Code 配置：

- 前端 `startRun`（AgentMuxPrototype.tsx:497）排除 CLAUDE/PI/OPENCODE，提示"暂不支持从 Agent Mux 独立启动"
- 运行弹窗下拉白名单（:892）为 `['codex','grok','opencode','gemini','hermes']`，与排除名单不一致（opencode 可选但必失败，属 UX bug）
- 根因在后端：`/api/agents/run`（agent_run.rs:1852）的 provider match 没有 CLAUDE_CODE_PROVIDER_ID；claude 的聊天走的是 backend.rs 专属的 `/api/claude/run`（ActiveRun 体系）

调研结论（2026-08-19）：

- **claude CLI 不支持 ACP**：`claude --experimental-acp` 报 unknown option（该参数是 Gemini CLI 的）；claude 2.1.232 二进制内无 ACP 实现。原设想的"复用 Acp driver"路线不成立
- 现有驱动：Acp（grok/opencode/gemini）、CodexAppServer（codex）、PiRpc（pi）、HermesJsonRpc（hermes）、DshWebApi（dsh）
- claude 的原生流式协议是 `-p --input-format stream-json --output-format stream-json --verbose`，backend.rs 已有完整 spawn 参数构造（build_claude_runtime_args）与事件解析（map_claude_json_line）
- 渠道 env 注入（agent_channels build_runtime 的 CLAUDE_CODE 分支）已现成，resolve_runtime 对 claude 可直接返回 ANTHROPIC_* env + settings.json 路径

## Objective

让 Agent Hub 运行任务入口能直接跑 Claude Code 配置（如 MiniMax 渠道"小菜鸡"），运行记录/事件流与其它 Agent 一致。

## Scope（方案待用户确认）

In scope:

- 后端 `/api/agents/run` 支持 claude-code（新 ClaudeStream driver：spawn `claude -p stream-json`，stream-json 事件归一为 AgentRunEvent）
- 前端下拉白名单与排除名单放开 claude（顺带修复 opencode 白名单不一致：opencode 后端本就支持，一并放开）
- 提示文案更新
- effort 传递：claude 支持 `--effort` 启动参数，driver 透传

Out of scope:

- Pi Agent 不放开（无用户场景）
- 不改 agent-mux CLI/Runtime 的独立运行能力（运行本就依赖 CodeM 后端在线）

## Impact

- `src-tauri/src/agent_run.rs`：AgentDriverKind::ClaudeStream、spawn/事件循环/stop/compact 分发点、acp_arguments 旁路
- `src-tauri/src/backend.rs`：复用/提取 claude spawn 参数与事件解析（避免重复实现）
- `src/components/AgentMuxPrototype.tsx`：:892 白名单 + :497 排除名单 + 文案

## Acceptance Criteria

- [ ] Agent Hub 运行任务下拉出现 Claude Code 配置（工程师GLM/小小打工仔/小菜鸡）
- [ ] 选"小菜鸡"（Claude Code · MiniMax-M3 · effort max）发起运行能真实执行并产出回复
- [ ] 运行事件流实时展示，完成后运行监控出现记录（与 Codex 等一致）
- [ ] opencode 配置（旺财）同样可发起运行（白名单不一致修复）
- [ ] 失败场景（渠道无效等）在运行详情展示错误事件

## Verification Commands

- `cargo test --lib`
- `node --import tsx --test src/lib/agent-mux-*.test.ts`（如有相关用例）
- 手动实测：桌面壳/Web dev 用"小菜鸡"发起运行

## Implementation Record

- 2026-08-20T13:10:20.747Z 确认 Markdown 异常由共享 sanitizeVisibleAssistantText 对每个流式 delta 删除前导换行导致；本次只修改该共享清洗步骤并补两段 delta 回归测试。
- 2026-08-20T13:03:30.746Z 定位 Claude 流式 Markdown 异常：原始 Claude JSONL 与开发模式 SQLite 均保留完整换行，根因是每个 delta 单独调用 sanitizeVisibleAssistantText 时移除了开头换行；修复需覆盖通用 Agent 事件与 Claude UI 流式路径。

- 2026-08-19T13:45:08.772Z Task created by Trellis automation.

## Verification Results

- 2026-08-20T13:38:01.930Z `Playwright: target thread 29d09e0a-ac3d-4092-8463-e052abcaffcb at http://127.0.0.1:5176`: 真实 DOM 确认 Markdown 分隔线为 hr、标题为独立 h2、代码块为 pre/code；截图 output/playwright/markdown-stream-fixed.png
- 2026-08-20T13:37:54.189Z `git diff --check`: 通过，无 whitespace 错误

- 2026-08-20T13:37:47.494Z `npm run typecheck`: tsc -b passed
- 2026-08-20T13:37:39.369Z `node --import tsx --test src/lib/agent-run-events.test.ts src/lib/conversation.test.ts`: 44 tests passed, including Markdown boundary newline regression

## Completion Summary

## Follow-ups

- 待补充。
