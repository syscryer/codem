# Task: 独立普通 AI 聊天完整链路

## Background

CodeM 当前所有主会话都属于项目内 Agent thread，运行链路依赖 Claude Code、Codex 或 Grok 等 Agent Provider。用户需要新增一套完全独立的普通 AI 聊天：聊天不依赖 Agent、不要求项目和工作目录，但仍可使用用户自定义的 API 供应商、多个已启用模型、附件、项目文件引用、MCP、Skills 与知识库。

交互继续沿用 CodeM 现有聊天窗口、消息流、输入框、工具步骤和右侧工作台。Cherry Studio 仅作为供应商/模型管理、模型搜索和知识库选择参考；CC Switch 仅作为精选供应商模板快速创建参考，不复制其大而全的供应商市场或推广条目。

当前另有 Trellis 会话正在修改 Agent 设置界面。本任务使用独立 worktree 和 `codex/ordinary-chat` 分支开发，优先新增独立模块；在对方改动完成前不修改其设置页面文件，最终接线前先检查差异。

## Objective

在不依赖 Agent 的前提下实现 CodeM 风格普通聊天、多供应商多模型配置、会话内模型切换、MCP、Skills、知识库、附件、历史与安全审批完整能力

## Scope

In scope:

- 左侧主入口将现有“新建聊天”改为“新建任务”，新增“新建聊天”。
- 左侧增加独立“普通聊天”分组，位于项目列表上方；支持按更新时间展示、置顶、重命名、搜索、导出和删除。
- 普通聊天全局存在，不属于项目或 Agent；可以显式引用已添加项目中的文件。
- 新增协议中立的普通聊天供应商与模型数据模型，一个供应商可启用多个模型。
- 内置精选官方供应商模板：OpenAI、Anthropic、Google Gemini、DeepSeek、MiniMax、Kimi、智谱 GLM、阿里云百炼/Qwen；保留 OpenRouter 和自定义入口。
- 模板只预填官方地址、协议、图标和文档链接；不携带 API Key、推广链接或第三方中转地址。
- 支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 和 Gemini 原生协议，并由 adapter 归一化流式事件、工具调用和错误。
- API Key 使用系统安全凭据存储或现有桌面 vault 抽象，SQLite 和日志不保存明文。
- 支持获取模型、手动维护模型、启用/禁用多个模型、测试连接、默认模型和能力标记。
- 每次消息只调用一个模型；供应商和模型在 Composer 底部选择，同一会话后续消息可切换其他供应商或模型。
- 切换模型不改写历史；新模型继续接收归一化后的现有会话上下文，每条回复保留真实供应商和模型快照。
- 支持流式文本、停止、失败重试、按原模型重新生成、编辑并重发、复制、删除、标题生成、上下文统计和历史恢复。
- 复用统一 content blocks 支持文本、图片、上传附件和 `@项目文件`；历史和 trace 只保存脱敏摘要。
- 普通聊天拥有独立工具循环，可加载用户选择的 MCP server 和 Skills，不依赖 Agent Provider。
- MCP 工具按能力和风险执行；外部写入、命令执行或不可逆操作必须显示确认卡，拒绝后把结构化结果返回模型。
- Skills 作为可选择的系统指令/工作流加载，记录来源和版本摘要，不把整份敏感内容写入 trace。
- 实现本地知识库：创建、导入文本/Markdown/代码/目录、切片、嵌入、索引、重建、删除、检索和来源引用。
- 聊天可多选知识库，回答展示命中来源；知识库与供应商、模型和 Agent 相互独立。
- 普通聊天复用 CodeM 主题变量、Markdown、代码块、工具步骤、滚动和右侧工作台，不建立割裂的新视觉系统。
- 覆盖明暗主题、窄窗口、长会话、大附件、长模型列表、频繁切换和运行中切换会话的性能与恢复。

Out of scope:

- 不实现一次提问让多个模型同时回答。
- 不把普通聊天包装成新的 Agent，也不显示 Agent 权限、工作树、Git 分支、Plan 或任务状态。
- 不自动执行未启用的 MCP、Skill 或知识库。
- 不导入 CC Switch 的大量中转商、合作伙伴、推广链接和排名体系。
- 不在日志、历史、debug events 或 raw events 中保存 API Key、base64、完整大文件或知识库全文。
- 不在另一个设置会话未完成时并行修改同一设置页面文件。

## Impact

- Frontend：应用位置和导航、普通聊天列表、普通聊天 workspace、Composer 工具区、供应商/模型菜单、工具确认卡、知识库引用和历史恢复。
- Backend：普通聊天 REST/streaming API、供应商 adapter、模型探测、工具循环、MCP bridge、Skills loader、知识库索引与上下文构建。
- Persistence：新增普通聊天、消息内容块、供应商、模型、消息模型快照、工具调用、知识库及索引元数据表；不复用 Agent `threads` 的 provider session 语义。
- Security/privacy：密钥安全存储、请求日志脱敏、附件/知识库摘要化、MCP 写操作审批、URL 与本地路径校验。
- Compatibility：Agent 项目线程、现有 `/api/claude/*`、`/api/agents/*`、队列、审批、会话恢复和设置原生管理行为保持不变。

## Acceptance Criteria

- [x] 左侧“新建任务”和“新建聊天”语义清晰，普通聊天列表独立于项目且支持完整会话管理。
- [x] 普通聊天在没有项目的情况下可以创建、发送、恢复和删除。
- [x] 精选供应商模板可快速创建配置，用户修改字段不会被模板更新覆盖。
- [x] 一个供应商可保存并启用多个模型；Composer 底部可以选择供应商和其中一个模型。
- [x] 同一会话切换供应商或模型后，下一轮使用新选择并延续已有上下文，旧回复模型快照保持不变。
- [x] 四类目标协议均能归一化流式文本、工具调用、停止和错误，模型不可用时明确报错且不静默回落。
- [x] API Key 不进入 SQLite、日志、错误正文、trace、导出文件或前端 bootstrap payload。
- [x] 图片、附件和 `@项目文件` 在普通发送、重试和历史恢复中语义不丢失。
- [x] MCP 与 Skills 可按聊天多选；工具调用按顺序展示，危险操作必须审批。
- [x] 知识库支持导入、索引、检索、重建、删除和多选，回答可以定位到具体来源。
- [x] 流式运行中切换普通聊天不会丢输出；刷新后可重连或得到明确终态。
- [x] 长会话、长列表、大文件和频繁模型切换没有明显整页重渲染或主线程卡顿。
- [x] 明暗主题、桌面宽屏、窄窗口和右侧工作台打开状态下布局完整。
- [x] Agent 现有 Provider、模型、权限、附件、MCP、Skills、审批和历史回归测试通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- `npm run build`
- `node --test --import tsx` 运行普通聊天、模型选择、content blocks、工具审批、知识库和现有 Agent 回归测试。
- 使用本地测试服务真实验证 OpenAI compatible 与 Anthropic streaming/tool call；可用凭据存在时再验证官方接口，不把凭据写入记录。
- 桌面开发模式验证新建聊天、模型切换、附件、MCP、Skills、知识库、停止、重试、刷新恢复、明暗主题和窄窗口。
- `git diff --check`

## Implementation Record
- 2026-07-13T22:15:48.269Z 最终审计收敛 styles.css 全文件选择器重组噪音，保留原基线并只追加 928 行普通聊天专属样式；隔离服务已重启到最新版本。

- 2026-07-13T22:15:47.515Z 完成普通 AI 聊天全链路：四协议与工具调用、MCP 审批、Skills、知识库、附件安全、消息级操作、导出、独立 Provider 管理和多聊天并发均已完成；设置页仅保留并行会话薄嵌入。
- 2026-07-13T20:32:23.042Z 完成普通聊天 Skills 多选与安全注入、运行重连、普通/Agent 统一搜索，并在隔离 5174/3101 服务完成浏览器视觉烟测。MCP 工具循环和消息级重试仍按计划继续。

- 2026-07-13T19:55:04.935Z 完成普通聊天运行中会话切换隔离：live turns 按 chatId 保存，后台运行结束不会覆盖当前查看聊天。完成四类 Provider 图片多模态 payload 映射。
- 2026-07-13T19:49:34.802Z 完成普通聊天前端首轮主接线：新增 App ordinary-chat location、独立 workspace、左侧聊天列表、草稿态、置顶/重命名/删除弹窗；Agent 入口文案改为新建任务，typecheck 通过。

- 2026-07-13T19:10:41.512Z 完成第一批普通聊天基础设施：独立 Rust router/service、ai_* SQLite schema、AES-GCM 本地密钥 vault、9 个精选供应商模板、供应商/多模型 CRUD、连接测试和模型发现；设置页未修改。
- 2026-07-13T18:54:21.546Z 已完成需求与隔离设计：普通聊天独立于 Agent/project，Composer 底部单选供应商与模型，会话内可切换并延续上下文；建立完整供应商、协议、MCP、Skills、知识库、附件、安全和恢复范围。已创建独立 worktree，确认核心实现先新增模块、设置页最后薄接线。

- 2026-07-13T18:51:14.697Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T22:15:53.464Z `隔离服务 5174/3101 健康检查`: 通过：最新 Rust backend 监听 3101，Web 监听 5174；主工作区 5173/3001 未受影响

- 2026-07-13T22:15:52.709Z `应用内浏览器 1280px/760px 普通聊天回归`: 通过：普通聊天入口、Provider 管理、知识库管理布局完整，无横向溢出，console error 为 0
- 2026-07-13T22:15:51.944Z `安全与编码扫描、git diff --check、git diff --cached --check`: 通过：未发现新增真实密钥、长 base64、Unicode 转义或空白错误

- 2026-07-13T22:15:51.218Z `node --import tsx --test src/lib/agent-run-events.test.ts src/lib/conversation.test.ts src/lib/conversation-changed-files.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-output-file-list.test.ts src/lib/conversation-output-file-interactions.test.ts src/lib/input-content-blocks.test.ts`: 通过：36 个 Agent、会话、附件与 content blocks 回归全部通过
- 2026-07-13T22:15:50.488Z `npm run typecheck && npm run build`: 通过：TypeScript 与生产构建成功，仅既有 Tauri 动静态导入和大 chunk 提示

- 2026-07-13T22:15:49.737Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 76 通过、1 个真实 Grok 登录测试忽略；desktop main 9/9 通过
- 2026-07-13T22:15:48.999Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过：Rust 格式与 backend 编译门禁均通过

- 2026-07-13T20:32:23.049Z `npm run build`: 通过：生产构建成功，仅既有 chunk 提示
- 2026-07-13T20:15:06.281Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib && npm run typecheck`: 通过：Rust 9/9，TypeScript 通过

- 2026-07-13T19:10:42.098Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过：普通聊天模块与 Rust 后端可编译
- 2026-07-13T19:10:41.809Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: 通过：4/4，覆盖 vault 明文保护、多模型单默认、模板和模型解析

## Completion Summary
- 2026-07-13T22:16:13.061Z 完成独立普通 AI 聊天完整版：多供应商多模型、四协议流式与工具调用、MCP 审批、Skills、知识库、附件安全、消息级操作、导出、Provider 管理、多聊天并发和完整恢复均已落地；最终门禁与应用内窄窗回归通过，隔离服务已更新。

普通 AI 聊天完整链路已完成：独立供应商/多模型配置、四协议流式与工具调用、MCP 与审批、Skills、知识库、附件安全、历史恢复、多聊天并发、消息级操作、导出和 Provider 管理均已接通。普通聊天可以直接打开独立 Provider 管理弹窗，不依赖并行设置页；设置页后续只需薄嵌入该组件。最终已通过 Rust 全量测试、TypeScript、生产构建、前端相关回归、安全与编码扫描，以及默认宽度和 760px 窄窗应用内 UI 烟测。

## Follow-ups

- 后续可增加更多官方供应商模板，但必须基于实际高频需求，不扩展为中转商市场。
- 多模型同时回答如果未来需要，作为独立提案设计，不进入当前运行模型。
- 并行设置页会话合并时，可把 `AiProviderManagerDialog` 薄嵌入设置导航；普通聊天当前已可独立配置和完整使用。
