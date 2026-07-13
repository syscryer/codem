# Task: Grok 与 Codex 图片及文件引用适配

## Background

CodeM 已经为 Claude Code 建立统一 `contentBlocks`、附件上传、`@文件`、队列和历史安全投影，
但通用 Agent 链路仍只接受纯文本，Grok Build 与 OpenAI Codex 的图片和文件能力被静态标记为不支持。
真实协议验证确认：Grok 0.2.99 虽在 ACP initialize 中少报 `image=false`，但 ACP `session/prompt`
可以接收并识别 image block，同时支持 `resource` / `resource_link`；Codex app-server 支持
`image` / `localImage`，本地文件可通过内联文本或路径上下文交给 Agent 读取。

## Objective

完整贯通通用 Agent 的图片、内联文件和文件引用输入，并按 Grok ACP 与 Codex app-server 原生协议映射，保持队列和历史脱敏语义

## Scope

In scope:

- Composer 对已接入的 Grok Build 与 OpenAI Codex 开放现有附件和 `@文件`入口。
- 通用 Agent 提交和运行队列完整保留 `contentBlocks`，用户消息只持久化安全投影。
- `/api/agents/run` 接收并校验统一输入块，允许只有附件没有文本的请求。
- Grok ACP 映射 `text`、`image`、`file_text`、`file_reference` 和附件元信息。
- Codex app-server 映射 `text`、本地/远程图片、内联文件文本和路径引用。
- Provider Registry 正确展示 Grok/Codex 图片和文件引用能力。
- 补充前后端回归测试，覆盖映射、队列和脱敏语义。

Out of scope:

- PDF/DOCX 内容提取和 document 原生块。
- 新的上传存储模型、附件预览器或拖拽交互重构。
- Grok/Codex 会话列表、导入和其他未接入能力。
- 修改 Claude Code 现有附件协议和运行行为。

## Impact

- Frontend：`App.tsx`、`Composer.tsx`、`useAgentRun.ts`、输入块 helper 与相关测试。
- Backend：`agent_run.rs`、`agent_runtime.rs`、`acp.rs`、`codex_app_server.rs`。
- Contract：`/api/agents/run` 新增可选 `contentBlocks`，旧 `prompt` 请求继续兼容。

## Acceptance Criteria

- [ ] Grok 与 Codex 聊天可选择、粘贴、拖入图片并正常发送。
- [x] Grok ACP 收到标准 image block；Codex 收到 `localImage` 或 `image` 输入。
- [x] 小文本文件以内联上下文发送，大文件/二进制/PDF/DOCX 以路径引用发送。
- [x] 运行中排队的通用 Agent 消息不会丢失图片或文件块。
- [x] 用户历史、debug 和 trace 不保存 base64 或完整文件正文。
- [x] Provider 能力页对 Grok/Codex 显示图片和文件引用支持。
- [x] 纯文本旧请求保持兼容，Claude Code 行为不变。

## Verification Commands

- `npm run typecheck`
- `node --test --import tsx src/lib/input-content-blocks.test.ts src/lib/composer-input-files.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/queued-prompts.test.ts`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- Rust 定向测试和真实桌面接口验证在获得编译许可后执行。

## Implementation Record

- 2026-07-13T10:19:44.442Z 更正 Codex 验证结论：用户截图确认 CodeM 内 Codex 当前可正常对话；当前 CodeM 后端 /api/agents/codex/probe 实际选择 C:\\Users\\csm\\AppData\\Local\\pnpm\\codex.CMD，并返回 authMode=chatgpt、authenticated=true。此前裸 CLI 401 来自独立探针进程未继承 CodeM 后端认证环境，不能作为 CodeM Codex 不可用的结论。
- 2026-07-13T10:01:14.631Z 差异复审补充：为避免 Axum Json 默认限制先于业务校验拒绝图片，请求体上限显式设为 42 MiB；统一校验限制最多 32 块、文本 1 MiB、单图 10 MiB、base64 图片总计 30 MiB。

- 2026-07-13T09:50:13.512Z 真实 Codex app-server 接受 localImage、image data URI、内联文件文本和路径文本并完成 userMessage 入队，但模型回合被本机 CLI 认证阻断：codex login status 为 Not logged in，运行返回 401 Missing bearer or basic authentication；协议字段另由当前 0.144.1 生成 schema 确认为 localImage.path 与 image.url。
- 2026-07-13T09:49:23.269Z 真实 Grok 0.2.99 ACP 复测通过：initialize 仍误报 image=false，但与实现一致的 image/resource/resource_link 多块 session/prompt 返回 end_turn，模型准确识别真实 CodeM 截图、INLINE_MARKER_713 和 README 路径引用。

- 2026-07-13T09:14:36.260Z 补充全量前端测试扫描：本次相关测试全部通过；全量套件仍有 4 条与本任务无关的既有源码断言失败，分别涉及 WorkspaceStatus session id 展示、macOS private API 配置、桌面 backend 退出清理和 BasicSettings 的 Git 审查分组，未在本任务中改动。
- 2026-07-13T09:11:43.336Z Rust /api/agents/run 已兼容可选 prompt 与 contentBlocks，并限制 32 块、1 MiB 文本、10 MiB 图片、有效 MIME/base64 与路径字段；Grok 映射 ACP image/resource/resource_link，Codex 映射 localImage/image 与文本路径上下文，Provider Registry 标记图片和文件引用为 supported。

- 2026-07-13T09:11:15.710Z 已贯通通用 Agent contentBlocks：前端按 Provider 能力开放图片与文件引用，队列按 thread 隔离保留完整输入，历史仅保存脱敏摘要；失败和中断保留队列，Grok/Codex 不注入运行中 guide。
- 2026-07-13T07:15:55.204Z 已确认范围：复用现有 contentBlocks；Grok 通过 ACP image/resource/resource_link，Codex 通过 localImage/image 与文本/路径上下文；不做 PDF/DOCX 深度解析，历史和 trace 继续脱敏。

- 2026-07-13T07:12:12.207Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T10:20:13.631Z `CodeM backend /api/agents/codex/probe`: pass: codex.CMD, chatgpt authenticated=true

- 2026-07-13T10:05:28.738Z `Codex 0.144.1 app-server localImage/image real probe`: blocked: CLI not logged in; input accepted, model request 401
- 2026-07-13T10:04:51.392Z `Grok 0.2.99 ACP image/resource/resource_link real probe`: pass

- 2026-07-13T10:01:46.893Z `git diff --check`: pass
- 2026-07-13T09:14:15.884Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: pass

- 2026-07-13T09:13:46.934Z `node --test --import tsx src/lib/input-content-blocks.test.ts src/lib/composer-input-files.test.ts src/lib/agent-provider-registry.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/queued-prompts.test.ts`: pass (66/66)
- 2026-07-13T09:13:03.720Z `npm run typecheck`: pass

## Completion Summary

## Follow-ups

- 后续按 Provider 能力增加 PDF/DOCX 原生解析或 document block。
