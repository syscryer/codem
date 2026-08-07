# CodeM Agent Provider 接入规范

## Status

Approved for implementation and future Provider onboarding.

## Goal

新增 Agent 时，一次性覆盖运行、对话、产物、状态、上下文、持久化、设置、安全和测试，避免出现“能回复，但其他产品能力没有接全”的半接入状态。

本规范是接入要求的唯一事实来源：

- OpenSpec 定义合同和完成标准。
- 自动化测试执行可验证门禁。
- `codem-agent-onboarding` Skill 只负责按本规范组织工作，不复制或改写合同。

## Non-Goals

- 不要求所有 Agent 具备完全相同的原生能力。
- 不用自然语言、终端文本或全工作区扫描猜测 Provider 未提供的结构化信息。
- 不在当前阶段实现动态加载的第三方 Provider 插件系统。
- 不把 Provider 凭据迁移到 CodeM，也不修改其全局登录状态。

## Architecture Boundary

CodeM 接入分为四层：

1. **Provider**：稳定产品身份、显示信息、生命周期和能力。
2. **Driver**：适配 ACP、JSON-RPC、stream-json、RPC 等原生协议。
3. **Runtime**：拥有进程或连接，处理 prompt、resume、cancel、approval、user input 和 close。
4. **CodeM Contract**：统一输入块、`AgentRunEvent`、timeline、文件变化、持久化和 UI 行为。

Provider 原始字段只能在 Rust Driver/适配层解释。Frontend 只消费 CodeM 稳定合同，不得新增 ACP、Codex、Pi 等协议字段分支。

## Provider Identity Contract

每个 Provider 必须定义：

- 稳定且不可复用的 `providerId`。
- 用户可见名称、品牌图标、Driver ID 和协议标签。
- `active` 或 `planned` 生命周期。
- CLI 发现、显式路径环境变量、版本、安装、更新和诊断策略。
- 默认渠道、支持的渠道协议及配置隔离方式。
- 模型目录、默认模型、思考等级的来源和刷新策略。
- Provider session ID 的创建、恢复和失效规则。

Frontend 静态元数据使用 `src/lib/agent-provider-metadata.ts` 作为唯一入口。新增 Provider 时，`AgentProviderId` 与该元数据必须同时更新并通过 TypeScript 完整性检查。

Backend 使用 `agent_runtime.rs` 的共享 Provider ID 校验。自动化、渠道和其他通用功能不得各自维护不一致的字符串白名单。

## Capability Contract

能力状态只允许：

- `supported`：已实现且有自动化或真实验收证据。
- `unsupported`：确认不支持，UI 隐藏入口或明确说明。
- `runtime-detected`：由 CLI 版本、模型或协议协商决定，必须覆盖存在和不存在两种路径。

所有 Provider 的最低能力：

- CLI 可用性或不可用原因可诊断。
- 文本输入与流式可见文本输出。
- 新会话、连续对话和明确的 Provider session 身份。
- 取消或明确声明不可取消。
- 明确且唯一的 terminal event。
- 历史持久化与刷新恢复。
- Markdown、链接和错误的统一展示。
- 日志、事件与历史脱敏。

以下能力按声明验收：

- 图片、内联文件和文件引用。
- 工具流、文件变化和 Diff。
- 权限审批、Plan 和结构化用户输入。
- 模型、思考等级、usage 和费用。
- MCP、Skills、插件或 Packages。
- Context、Compact、Fork、Archive、Steer 和原生 Review。

Provider 未通过最低能力前不得设为 `selectable`。声明为 `supported` 的能力未通过对应门禁，同样不得进入正式可选状态。

## Input Contract

统一输入使用 `contentBlocks`：

- `text`
- `image`
- `file_text`
- `file_reference`
- `attachment_metadata`

Driver 必须完成 Provider 原生映射，并满足：

- 允许只有附件没有文本的合法请求。
- 普通发送、运行中队列、guide、重试、恢复和自动化不能丢附件语义。
- 图片不能被提示词诱导为文本文件读取。
- 历史、debug、trace 不保存 base64、大文件全文或敏感正文。
- Provider 不支持的输入必须在发送前明确拒绝，不能静默丢弃。

## Runtime And Event Contract

Provider 事件至少映射到适用的统一事件：

- `status`、`phase`
- `session`
- `delta`、`thinking-delta`
- `tool-start`、`tool-input-delta`、`tool-stop`、`tool-result`
- `request-user-input`、`approval-request`
- `usage`
- `done`、`error`

运行规则：

- 每轮必须且只能出现一个 `done` 或 `error`；断流无终态由 frontend 明确收口为失败或停止。
- 事件需要稳定 `runId`，工具与交互请求需要稳定 ID。
- 重复、乱序、迟到事件不能污染其他 thread 或已结束 turn。
- 公开思考文本只能来自 Provider 公开协议；隐藏思维链不得推断、保存或展示。
- 工具输入、结果、stderr 和 raw event 必须限制大小并脱敏。
- 热 Runtime 复用至少比较 Provider、thread、workspace、session、渠道、模型、思考等级和权限。
- thread、project 删除或应用关闭时，必须清理对应 Runtime 和短期 run record。

## Conversation And Artifact Contract

### Timeline

实时 stream、Provider 历史和 SQLite 恢复必须生成一致的 `turn.items`：

- Text、Thinking、Tool 按事件顺序恢复。
- 审批和用户提问保持可交互语义，不降级为普通工具错误。
- `pending/running` 热 turn 不被历史刷新覆盖。
- 完成 turn 不因实时与历史合并而重复。

### Markdown And Links

所有 Agent 的最终文本必须进入共享 `MarkdownContent`：

- HTTP/HTTPS 链接使用统一外部打开或工作台预览。
- Windows 绝对路径、相对路径和 Markdown 本地文件链接使用统一文件打开与右键菜单。
- 图片、代码块、复制和 GFM 行为不能由 Provider 自行实现。
- Driver 不负责拼接 UI HTML。

### Files And Documents

能修改文件的 Agent 必须把原生事件归一为 `tool-result.content.changes[]`：

```json
{
  "changes": [
    {
      "path": "docs/report.md",
      "kind": { "type": "add" },
      "content": "...",
      "diff": "..."
    }
  ]
}
```

规则：

- `kind.type` 只使用 `add`、`update`、`delete`、`move`。
- 移动使用 `kind.move_path` 表示目标路径。
- 文件产出卡片、修改摘要、单文件 Diff、“审查全部”和上下文岛全部消费同一结构。
- 不从 assistant 自然语言或全工作区 Git 扫描猜测文件变化。
- 没有充分结构化证据时不生成虚假文件卡片或精确 Diff。

## Context And Status Contract

### Context

上下文信息必须标明来源：

- Provider 原生精确值。
- 基于公开 usage 的估算值。
- 不支持。

不得把估算值包装成 Provider 原生数据。Context、Compact 等入口按能力显示。会话上下文岛继续从统一 timeline、文件变化和 Agent Mux `threadId` 关联派生，不增加 Provider 专属数据岛。

### Status

统一状态至少覆盖：

- 连接中
- 思考中
- 执行工具
- 生成回复
- 等待用户
- 运行完成
- 运行失败
- 已取消
- 热连接可复用

工作区底部状态使用共享 runtime kind 和 Provider 元数据。新增 Provider 不得通过手写页面名单决定是否查询 `/api/agents/runtime/:threadId`。

## Persistence Contract

必须持久化或安全重建：

- CodeM thread 与 Provider ID。
- 已确认有效的 Provider session ID。
- 渠道、模型、思考等级和权限快照。
- user content block 安全摘要。
- Text、Thinking、Tool、审批和提问的 timeline 顺序。
- usage、duration、terminal status 和可恢复错误摘要。

不得持久化：

- API Key、access token、代理密码或 CLI 登录缓存。
- 图片 base64、大附件正文、未限制的 raw event 或 stderr。
- Provider 隐藏思维链。

## Product Surface Checklist

新增 Provider 时逐项检查：

- Provider Registry 与 capability。
- CLI 发现、诊断、安装、更新和文档入口。
- Provider 图标、设置标签和默认 Agent。
- 系统渠道、自定义渠道、模型与思考等级。
- 新聊天、运行、队列、guide、取消和恢复。
- Composer 附件、`@文件` 与能力禁用态。
- Timeline、Markdown、链接、图片和工具。
- 文件产出、Diff、审查与撤销边界。
- WorkspaceStatus、会话管理和 runtime 清理。
- Context、Compact、Fork、Steer 等能力入口。
- 自动化、Usage、通知和 Agent Mux thread 关联。
- Global Prompt、MCP、Skills、插件/Packages 的支持或明确不支持。
- README、Trellis 任务、协议说明和发布说明。

## Verification Matrix

### Contract Tests

- Provider ID 唯一、元数据完整、生命周期与 selectable 合法。
- Provider 运行路由、显示名、协议标签、图标和高风险产品列表完整。
- 输入块到 Provider 协议映射及不支持输入拒绝。
- 文本、公开思考、工具、审批、提问、usage 和 terminal event 映射。
- 重复、乱序、超长、敏感和断流事件。
- `changes[]` 的新增、修改、删除、移动、失败和截断。

### Frontend Integration Tests

- 同一统一事件 fixture 在不同 Provider 下生成相同 timeline 语义。
- Markdown 外链、本地绝对路径、相对路径、图片和代码块。
- 输出文档、单文件预览、Diff、审查全部和上下文岛。
- 运行状态、热连接、等待用户、完成、失败和取消。
- 队列、guide 与附件不丢失。

### Persistence Tests

- SQLite round-trip 后 timeline 类型、顺序和 Provider/session 身份一致。
- 刷新不会覆盖热 turn，也不会重复完成 turn。
- 无效 session 不写回，Provider 或渠道切换不串会话。
- 历史、debug 和 trace 不含凭据、base64 或大正文。

### Real CLI Acceptance

正式启用前至少在目标桌面平台验证：

1. CLI 探测、版本、登录状态和模型读取。
2. 首轮文本、第二轮 session 恢复和热 Runtime 复用。
3. 取消、进程异常和错误可读性。
4. 一个真实工具调用及其状态顺序。
5. 若支持文件修改：生成文档、显示产物卡片、点击打开、Diff 和刷新恢复。
6. 若支持图片/文件：真实附件发送和历史安全投影。
7. 若支持审批/提问：真实交互写回。
8. 渠道切换、应用重启和 thread 隔离。

真实验收缺失时只能标记为开发完成或预览，不能声称完整生产可用。

## Definition Of Done

- Provider 元数据、能力和 Driver 已完成。
- 最低能力全部通过，支持能力有对应测试。
- 实时、历史和 SQLite 三条路径一致。
- 文档输出、链接、上下文和状态完成真实 UI 验收。
- 安全扫描没有凭据、base64 或敏感 raw event 泄漏。
- Targeted tests、`npm run typecheck`、Rust format/test 和 `npm run build` 通过。
- Trellis 记录实际验证结果与未验证边界。
- Provider 仅在上述条件满足后设为正式 `selectable`。
