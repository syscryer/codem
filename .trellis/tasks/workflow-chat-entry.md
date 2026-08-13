# Task: 主聊天触发已启用工作流

## Background

已启用工作流目前只能在 CodeM 工作流管理页启动。用户在外部 Codex 主 Agent 聊天中要求启动工作流时，已安装的 `codem-agent-mux` Skill 只能发现 Agent 和执行单次 `invoke`，既看不到工作流目录，也没有 DAG 编排协议，因此主 Agent 不会调用工作流。

## Objective

让主聊天识别用户指定的已启用工作流并真正启动工作流执行，而不是直接绕过工作流调用当前 Provider。

## Scope

In scope:

- 为 `codem-agent-mux` CLI 增加只读的 `workflows --json` 命令。
- 命令只返回 `active` 工作流的完整定义，草稿和已下线工作流不可见。
- 扩展生成的 Agent Mux Skill，使主 Agent 能按名称或 id 选择工作流，并按 DAG、并行依赖、多轮讨论和人工确认语义主持执行。
- 继续复用现有 `invoke` 完成真实子 Agent 调用。
- 补充工作流目录过滤测试，并同步开发环境已安装 Skill。

Out of scope:

- 在 CLI 内重新实现一套长期运行的工作流调度服务。
- 自动猜测普通聊天是否应触发工作流；只有用户明确要求或点名工作流时触发。
- 草稿调用、审批自动通过、失败静默降级和工作流版本历史。

## Impact

- `codem-agent-mux` CLI 新增只读目录命令，现有命令兼容不变。
- 已安装 Skill 更新后，Codex 等主 Agent 可以发现并主持已启用工作流。
- 工作流节点仍通过现有 Agent Mux 运行接口执行并保留子 Agent 运行记录。

## Acceptance Criteria

- [x] `workflows --json` 返回结构化的已启用工作流定义。
- [x] 草稿和已下线工作流不出现在可调用目录中。
- [x] Skill 在用户明确要求调用工作流时先查询目录，再按 DAG 执行节点。
- [x] 无匹配、多匹配、配置缺失、Agent 失败和人工确认均保留真实边界。
- [x] 现有 `agents`、`invoke`、`status` 和 `cancel` 行为不变。
- [x] 开发环境 CLI 和已安装 Skill 更新后可供用户重新测试。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-13T03:23:42.985Z 定位根因：用户在外部 Codex 主 Agent 聊天测试，而现有 codem-agent-mux Skill/CLI 只能发现和调用单 Agent，不暴露工作流目录。已增加 workflows --json（仅 active），并扩展 Skill 的 DAG、并行、多轮讨论和人工确认主持协议。

- 2026-08-13T03:13:31.080Z Task created by Trellis automation.

## Verification Results
- 2026-08-13T03:23:43.309Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux; npm run typecheck; npm run build; git diff --check; codem-agent-mux workflows --json`: 全部通过：CLI 单测 21/21；类型检查、构建和 diff 检查通过；桌面开发版重启后实际读取到已启用的测试工作流及其 Codex/Claude Profile 绑定；已安装 Skill 已同步。

- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem-agent-mux`：21/21 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅有已有 Vite chunk-size / mixed import 警告。
- `git diff --check`：通过。
- 重启桌面开发模式后，实际执行 `workflows --json` 成功读取当前已启用的“测试工作流”，包含完整节点、连线以及 Codex / Claude Profile 绑定；安装版未改动。
- 开发环境 `C:\Users\syscr\.codex\skills\codem-agent-mux\SKILL.md` 已同步工作流协议。

## Completion Summary
- 2026-08-13T03:23:43.621Z 完成外部主 Agent 工作流入口：已启用工作流可被 CLI 发现，Codex Skill 可按 DAG 主持真实 Agent 调用；草稿/下线流程不可见，失败和人工确认保持真实状态。

已修复外部主 Agent 无法发现和调用工作流的根因。CLI 现在提供只包含已启用定义的工作流目录；生成及已安装的 Skill 明确要求主 Agent 在用户点名工作流时查询目录，并按 DAG 依赖、并行节点、多轮讨论、人工确认和结束汇总规则，通过现有 `invoke` 执行真实子 Agent。

## Follow-ups

- 后续若需要工作流在主 Agent 退出后仍独立运行，再将主持逻辑下沉为 Runtime 原生调度器。
