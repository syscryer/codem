# Task: Claude 在新聊天中继续

## Background

CodeM 已为 Codex 完成“在新聊天中继续”：顶部更多菜单和侧边栏右键菜单共用同一入口，
后端通过 Provider 原生 Fork 创建独立会话，并用本地操作记录保证幂等、失败恢复和原子落库。
Claude Code 当前已有热会话、`--resume`、历史导入、审批和用户输入闭环，但该入口仍明确限制为
Codex，Claude 聊天无法从当前上下文创建独立分支。

本机 Claude Code 2.1.220 已公开 `--fork-session`：与 `--resume <sessionId>` 一起使用时，
保留原会话上下文并创建新的原生 session ID。CodeM 后端目前只在普通恢复中传递 `--resume`，
没有传递 `--fork-session`，也没有把新 session ID 绑定到新的 CodeM thread。

## Objective

复用现有会话菜单，通过 Claude 原生 --resume 与 --fork-session 创建独立的新聊天，并覆盖能力降级、状态门禁和恢复语义

## Chosen Design

采用“共享产品入口与本地 Fork 事务，Provider 原生实现分流”的方案：

- 前端继续使用现有 `prepareThreadFork` / `forkThread`、能力状态、处理中状态和两个菜单入口。
- `/api/projects/{projectId}/threads/{threadId}/fork/capability` 与 `/fork` 保持共享产品契约，
  后端根据源 thread 的 Provider 选择 Codex App Server 或 Claude CLI 原生实现。
- Codex 路径保持现状；Claude 路径启动一次性 Fork 进程，使用源线程的工作目录、渠道环境、
  模型和权限配置，并追加 `--resume <sourceSessionId> --fork-session`。
- Claude Fork 进程只完成会话创建和新 session ID 确认，不发送用户 prompt，不触发模型生成。
- 只有拿到与源 session ID 不同的有效新 session ID 后，才在本地事务中创建并显示子 thread。
- 新 thread 的可见历史从 Claude 原生 transcript 解析；transcript 暂未就绪时进入
  `history_pending`，通过现有恢复流程重试读取，不复制源 thread 的 SQLite messages 伪造成功。

### Alternatives Considered

1. **共享 API、Provider 分流（采用）**：复用现有 UI、操作表和恢复闭环，新增 Claude 原生桥接；
   改动集中且用户体验一致。
2. **新增 Claude 专用 Fork API**：实现边界直接，但前端会出现两套能力缓存、错误语义和恢复逻辑，
   后续 Provider 扩展还会继续重复。
3. **本地复制聊天，首次发送时再 Fork（拒绝）**：点击后响应简单，但新 thread 在首次发送前没有
   独立 Provider 身份，可能与源 thread 共用 session ID，也无法证明模型上下文已原生分叉。

## Data Flow

1. 用户打开顶部更多菜单或侧边栏右键菜单，前端按 Provider、session ID、运行状态、人工输入状态
   和本地 Fork 状态计算可用性。
2. 能力请求由后端从数据库读取源 thread 的真实 Provider 和运行配置；客户端不能伪造 Provider、
   session ID、工作目录或渠道。
3. Claude 能力探测只读检查当前可执行文件是否支持 `--fork-session`，结果按命令身份短期缓存；
   显式刷新、CLI 更新或命令变化后重新探测。
4. 用户确认执行后，后端先创建或复用 `thread_fork_operations` 操作记录，再调用 Claude 原生 Fork。
5. 原生进程返回新的 session ID 后，后端标记 Provider 已成功；随后读取新 Claude transcript，
   在单个 SQLite 事务中创建子 thread、保存历史和切换 selection。
6. 前端使用现有 `ThreadForkResponse` 原子接入新 thread 并打开；源 thread 和其热 runtime 保持不变。
7. Provider 已成功但 transcript 暂不可读时，子 thread 可处于 `history_pending`，后续通过同一
   operation ID 恢复历史，不再次执行 `--fork-session`。

## State And Identity Rules

- 源、新 CodeM thread ID 必须不同；源、新 Claude session ID 必须不同。
- 子 thread 继承项目、标题、自定义标题标记、工作目录、Provider、渠道、模型、effort 和权限模式。
- 子 thread 不继承源 thread 的运行状态、发送队列、审批、用户输入请求、debug/raw events 或热 runtime。
- 源 thread 的 session ID、历史、selection 外状态和 runtime 不得被修改或关闭。
- 同一源 thread 同一时间只允许一个活动 Fork operation；重复请求使用 operation ID 幂等返回。
- 应用重启后，`provider_succeeded` / `history_pending` 继续完成本地绑定或历史读取；
  `result_unknown` 不自动再次 Fork，避免创建重复 Claude 会话。

## Capability And Compatibility

- `openai-codex` 和 `claude-code` 都可以进入共享 Fork 可用性判断，其他 Provider 继续明确禁用。
- Claude CLI 不存在、`--help` 不包含 `--fork-session`、新 session ID 缺失或与源 ID 相同，均视为
  不支持或协议失败，不创建可见本地 thread。
- 旧版 Claude CLI 的禁用提示使用“当前 Claude Code 不支持在新聊天中继续，请升级 Claude Code”。
- Claude 普通发送、热会话、`--resume`、Compact、审批、用户输入和历史导入行为保持不变。
- Codex Fork 的 capability、App Server 请求、历史归一化和恢复语义保持不变。

## Failure, Security And Privacy

- 运行中、正在启动、等待审批、等待用户输入或已有 Fork 操作时，前后端都拒绝 Fork。
- Provider 调用失败时不创建本地 thread；错误文本去控制字符并限制长度后返回。
- Provider 成功、本地失败时保留最小操作记录；重试只完成本地事务，不再次创建 Provider session。
- Provider 结果不确定时保持 `result_unknown`，提示用户稍后重试核对，不自动发送 prompt 或重新 Fork。
- Fork 不发送用户消息，不产生模型请求，不提升权限，也不读取工作区外文件。
- 不在 operation、trace、debug/raw events 中保存渠道密钥、环境变量、完整命令参数或 transcript 全文。
- 工作目录继续通过项目范围校验；渠道配置由后端从源 thread 解析，客户端不能覆盖。

## Scope

In scope:

- 将现有“在新聊天中继续”入口扩展到空闲且已绑定 session ID 的 Claude Code thread。
- 将前端 `CodexThreadForkCapability` 等只限 Codex 的命名和文案收口为共享 thread fork 语义。
- 为 Claude Code 增加只读 `--fork-session` capability 探测与短期缓存。
- 为 Claude Code 增加无 prompt 的原生 Fork 创建、新 session ID 校验和 transcript 历史读取。
- 复用并按 Provider 扩展现有 Fork operation 幂等、事务、恢复和响应契约。
- 覆盖旧 CLI、运行中、人工输入中、重复点击、Provider 成功后本地失败和重启恢复。

Out of scope:

- 不支持从指定历史轮次分叉，只支持当前完整会话。
- 不为 Grok、OpenCode、Pi 或普通聊天模拟 Fork。
- 不复制源 thread 的 SQLite messages、摘要或可见文本作为 Claude 原生 Fork 的替代品。
- 不接入 checkpoint / rewind、后台 Agent、Hooks UI、会话命名、`--from-pr` 或 Ultrareview。
- 不新增菜单、弹窗、分叉树或独立页面。
- 不改变 Claude CLI 安装、认证、更新、渠道密钥保存和普通运行参数语义。

## Impact

- Frontend：`src/lib/codex-thread-fork.ts`、`src/hooks/useWorkspaceState.ts`、`src/types.ts` 及定向测试；
  `ChatHeader` 和 `SidebarProjects` 继续复用现有入口，仅同步共享文案或类型。
- Backend：`src-tauri/src/backend.rs` 中 Fork 路由、源 thread 校验、operation 恢复、Claude 参数构建与
  transcript 读取；如职责过重，仅提取聚焦的 Claude Fork helper，不做无关重构。
- Persistence：优先复用 `thread_fork_operations` 和现有 threads/messages/tool_calls 事务；
  只有现有操作表无法区分恢复策略时才增加最小 Provider 字段，并补兼容迁移测试。
- Runtime：Claude Fork 使用独立一次性进程，不复用或关闭源 thread 热 runtime。
- Performance：capability 探测短期缓存；历史继续使用现有分页/归一化路径，不一次性在前端复制大树。

## Acceptance Criteria

- [ ] 空闲、已绑定有效 session ID 的 Claude thread 在顶部菜单和侧边栏右键菜单均可执行
  “在新聊天中继续”；Codex 原入口无回归。
- [ ] Claude Fork 实际使用 `--resume <sourceSessionId> --fork-session`，不发送 prompt，返回的新
  session ID 非空且与源 ID 不同。
- [ ] 新 thread 具有独立 CodeM/Claude 双 ID，并继承项目、工作目录、Provider、渠道、标题、模型、
  effort 和权限；源 thread 保持不变。
- [ ] 新 thread 的历史来自 Claude transcript；不直接复制源 SQLite messages，历史暂不可读时可恢复。
- [ ] 运行中、启动中、等待审批、等待用户输入、缺少 session ID 或正在 Fork 时，前后端均拒绝操作。
- [ ] 不支持 `--fork-session` 的 Claude CLI 禁用入口并提示升级；普通 Claude 发送和恢复仍可用。
- [ ] 重复点击和重复 operation ID 不会创建多个 Claude session 或多个本地 thread。
- [ ] Provider 失败不留下可见 thread；Provider 成功后本地失败或历史失败可以幂等恢复，不重复 Fork。
- [ ] 刷新或重启后，新旧 thread 的历史和 session 映射正确，队列、审批、用户输入、debug/raw 和
  runtime 状态不会串到子 thread。
- [ ] 定向前端测试、Rust 单测、typecheck、构建和真实桌面双入口验收通过。

## Verification Commands

- `npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_fork`
- `cargo test --manifest-path src-tauri/Cargo.toml thread_fork`
- `cargo test --manifest-path src-tauri/Cargo.toml claude_run_args`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- 桌面验收：从顶部菜单和侧边栏右键各 Fork 一次真实 Claude 会话，确认新旧 session ID、历史、
  独立续聊和重启恢复；运行中与旧 CLI fixture 验证禁用提示。

## Implementation Record

- 2026-08-02T13:13:34.889Z Task 2 Claude CLI Fork Protocol Bridge 已实现：新增 claude_session_fork 模块并在 lib.rs 注册。TDD RED1：仅注册模块+测试时 cargo test claude_session_fork 报 E0432 unresolved imports (help_supports_fork_session/extract_fork_session_id)；实现纯函数后 RED2：报 unresolved import read_fork_session_id。GREEN：cargo test claude_session_fork 7 passed/0 failed。覆盖 help_supports_fork_session 精确识别 --fork-session、extract_fork_session_id 仅接受 system/init 且新 session ID 不同、read_fork_session_id 忽略非 JSON/其他事件并 EOF 无 init 为 Uncertain、probe_fork_session（--help 只读探测）、create_session_fork（tokio process + piped stdio + Windows CREATE_NO_WINDOW + 10s 协议超时 + init 后关 stdin 优先优雅退出超时才 kill + stderr 折叠控制字符/空白并截断 512）。真实进程测试用 type/cat 验证成功路径、EOF 无 init Uncertain、超时 kill Uncertain。不发送 prompt，不接 backend.rs。
- 2026-08-02T12:41:42.707Z Task 1 前端 Provider-Neutral Fork Contract 已实现：将 codex-thread-fork 源码与两份测试收口为 thread-fork；CodexThreadForkCapability 更名为 ThreadForkCapability；Claude Code 与 Codex CLI 共用 availability、capability 请求和原子响应接入，其他 Provider 明确禁用。TDD RED：定向测试 11 项中 3 项按预期失败（Claude 被拒绝、Provider 文案不一致、中性模块未接线）；GREEN：11/11 通过。

- 2026-08-02T12:20:59.195Z 完成 Claude 在新聊天中继续实施计划：五个 TDD 切片覆盖共享前端契约、Claude CLI 协议桥、可信能力分流、事务/历史恢复和真实桌面验收。
- 2026-08-02T11:12:46.236Z 完成 Claude 在新聊天中继续设计：共享现有 Fork UI/API/本地事务，Provider 层分流到 Claude 原生 --resume + --fork-session；明确无 prompt 创建、双 ID、能力降级、状态门禁、幂等恢复、安全隐私和验收边界。

- 2026-08-02T11:09:19.271Z Task created by Trellis automation.
- 2026-08-02 已确认采用共享产品入口和本地 Fork 事务、Provider 原生实现分流的设计；Claude 使用
  无 prompt 的 `--resume + --fork-session` 获取独立 session ID，子 thread 仅在 Provider 身份确认后可见。

## Verification Results

- 2026-08-02T13:13:50.769Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：cargo fmt --check exit 0；git diff --check exit 0（仅 LF→CRLF 行尾归一化提示，非内容错误）。范围仅 lib.rs 与 claude_session_fork.rs，未触碰 backend.rs 与 .tmp-dev/。
- 2026-08-02T13:13:50.327Z `cargo test --manifest-path src-tauri/Cargo.toml claude_session_fork`: 通过：lib unittests 7 passed / 0 failed（含 help 精确识别、init session ID 校验、async reader 忽略非 init、EOF 无 init Uncertain、真实进程成功返回 child-session、EOF Uncertain、超时 kill Uncertain）。

- 2026-08-02T12:41:42.739Z `npm run typecheck`: 通过：tsc -b exit code 0。
- 2026-08-02T12:41:42.709Z `npx tsx --test src/lib/thread-fork.test.ts src/lib/thread-fork-ui.test.ts`: 通过：11 tests，11 pass，0 fail；覆盖双 Provider availability、状态门禁、Provider 文案、响应 ID、history loaded/pending、debug/raw 隔离、capability key 全字段及双 UI 入口。

## Completion Summary

## Follow-ups

- Claude checkpoint / rewind、后台 Agent 管理和 Hooks 可观察性按独立任务设计，不混入本次 Fork。
- 完成 Claude Fork 后，再按同一证据标准审计 Grok、OpenCode 和 Pi 的高价值能力缺口。
