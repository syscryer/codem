# Findings

## Claude CLI
- `claude --help` 可正常执行，说明本机已经安装并可从命令行调用。
- 非交互模式可使用 `-p` 或 `--print`。
- 流式 JSON 输出需要同时携带：
  - `--verbose`
  - `--output-format stream-json`
- 为了实时显示文本片段，建议增加：
  - `--include-partial-messages`
- 返回流中包含 `session_id`，可以用于后续续接会话。

## 结构选择
- `React + Vite` 负责 UI。
- `Express` 负责本地桥接，使用 Node `spawn` 启动 `claude`。
- 前后端之间使用 `NDJSON` 流，前端用 `fetch` 读取 `ReadableStream`。

## Windows 注意点
- 工作目录路径要走 `path.resolve`。
- 直接解析出 `claude.exe` 的真实路径后再 `spawn`，比 `shell: true` 更安全。
- 后端需要同时处理 stdout 的 NDJSON 和 stderr 文本，避免 CLI 报错时前端无感知。

## 校验结果
- `npm install` 已完成。
- `npm run typecheck` 已通过。
- 本地启动后，`GET /api/health` 返回：
  - `available: true`
  - `command: 已检测到可用的 claude.exe 命令路径`
- 当浏览器连接关闭时，后端现在会主动取消对应 Claude 进程，避免残留后台任务。
- 当前 UI 可以展示 Claude CLI 暴露出来的完整运行事件，包括工具调用和工具结果。
- 模型内部隐藏思考链不属于 CLI 暴露内容，不能也不应在 UI 中伪造展示；可以展示可见状态和事件。
- OpenSpec 对齐后，主界面应以对话流为主，工具调用应作为 assistant turn 内的轻量 step，而不是全局 timeline 大卡片。
- `system/raw/snapshot` 等事件适合进入调试抽屉，避免干扰主对话。
- assistant 正文与工具调用必须按事件到达顺序共同渲染，不能分别渲染正文和工具列表，否则会出现顺序错位。
- 在 CSS grid 消息布局中，assistant 的所有正文和工具内容必须包进同一个右侧内容列，否则后续子元素会被自动排到左侧标签列。
- Any-code 的工具注册体系不适合直接迁移到 CodeM；CodeM 当前更适合继续沿用 `ToolStep + AssistantItem`，在工具标题、结果合并、专用预览和历史解析上补覆盖。
- `system/init` 仍应留在调试信息，不进入主对话；`EnterPlanMode` 可以作为轻量工具卡显示，`ExitPlanMode` 继续走审批卡。
- 子代理 `isSidechain` 事件不应直接插入主 assistant 文本；更稳妥的展示方式是通过 `parent_tool_use_id` 挂到父 `Agent/Task` 工具详情中。
- 工具结果可能晚于工具调用、跨消息到达，历史修复应优先按 `toolUseId` 回挂，找不到再回退到最近未完成工具。

## Claude 会话来源与历史解析

- Claude Code 会话的权威来源是 `~/.claude/projects/**/*.jsonl`。
- 已绑定 `session_id` 的线程如果 jsonl 不存在，不应从 SQLite 旧缓存推断历史、标题或可见性；这会制造重复线程和过期会话。
- SQLite 中的 `messages` / `tool_calls` 只作为可刷新缓存和本地未绑定草稿的存储；对已绑定 session，历史应可由 jsonl 重建。
- `agent-*.jsonl` 是子 Agent 内部会话，不应作为主线程导入；实时流中的 `isSidechain` 事件也不应进入主对话。
- transcript 中 `isMeta`、技能注入 prompt、continuation prompt 以及旧格式 `<thinking>` 文本都不是用户可见主对话内容。
- 工具结果必须绑定到真实 tool use；空 `done` 和空 assistant 文本不能被当作成功输出。

## 右侧工作台需求发现

- 用户明确区分了两个入口：文件夹图标是文件视图单按钮；最右侧分栏图标才是右侧面板的收缩开关。
- 右侧面板不是 Git 专用，而是可扩展工作台，可承载 `概览`、`文件`、`浏览器` 等工具页。
- `文件` 页默认展示 `所有文件`，也可以切换到 `已更改文件`。
- `已更改文件` 的目标形态接近 IDE 的 Changes/Diff 面板：左侧 diff 预览，右侧已更改文件树。
- `浏览器` 页第一版可以先是空白页 + URL 输入，不需要立即接真实页面加载。
- 顶栏文件夹按钮更适合作为 `所有文件` 入口，点击后打开右侧工作台并切到 `文件 / 所有文件`。
- 顶栏 `+60 -6` 更适合作为 Git 审查入口，点击后打开右侧工作台并切到 `文件 / 已更改文件`。
- 提交弹窗与右侧工作台职责不同：工作台用于常驻审查与工具查看；提交弹窗用于最终提交/推送表单。
- 第一版不应把“文本编辑器保存”纳入范围，否则会引入文件写入、冲突保护、未保存状态等复杂问题。
- 布局上需要保证工作台关闭时聊天区吃满；打开时聊天区不出现横向滚动，底部 composer 仍可正常使用。
- AI 写入/修改文件后的文件卡片也应进入右侧工作台预览，而不是只提供外部打开；这能让“写申请材料/写规划文档”这类任务形成即时预览闭环。
- 文件预览适合采用工作台内动态 tab：固定 tab 是 `概览/审查/浏览器`，文件 tab 是用户打开的文档，例如 `right-workbench.md`、`task_plan.md`。
- Markdown 是第一优先级预览类型，应渲染为阅读视图；普通文本可以只读代码预览；二进制和过大文件显示不可预览。
- 文件预览第一版仍不做保存，避免引入真实编辑器复杂度。
- 所有文件视图不应一次性递归扫描完整仓库，尤其要避免 `node_modules` 这类目录造成卡顿；更适合按文件夹懒加载一级内容。
- 已更改文件不需要读取真实目录树，可以将 Git status 返回的路径组装成虚拟目录树，这样更快也更接近 Codex/IDE 的变更视图。
- 右侧工作台更适合采用“左侧预览 tab + 右侧文件树”的结构，文件树负责导航，预览区负责 diff、Markdown 和代码阅读。

## Rust 后端真实接口对照发现

- 原版项目目录为 `D:\cursor_project\codem`，当前 Rust 重构目录为 `D:\ai_proj\codem`。
- 当前用户要求不是只验证路由存在，而是用原版接口行为做逐接口真实对照。
- 第一轮接口对照脚本有缺陷：`POST /api/projects` 返回字段是 `projectId`，`POST /api/projects/:id/threads` 返回字段是 `threadId`，脚本只取 `project.id/id`，导致大量请求落到 `/api/projects/undefined/...` 和 `/api/threads/undefined/...`。
- 路由覆盖已达到 old=96、rust=96、missing=[]、extra=[]，但行为差异仍需继续修。
- 初筛真差异包括：`/api/claude/version-info` 字段不兼容、`/api/claude/system-prompt` GET 缺少 metadata、settings 更新未按旧版 normalize、临时目录文件预览权限策略不一致、错误响应文本/JSON 格式不一致。
- 最终对照脚本固定使用旧版 `http://127.0.0.1:39201` 和 Rust `http://127.0.0.1:39202`，结果写入 `%TEMP%\codem-api-compare-fixtures\api-compare-results.json`。
- 最终 50 个真实接口全部通过：workspace、project/thread、Git、Claude run、MCP/configs、plugins/skills、settings、file/image/attachments 均完成状态码和结构对照。
- 对照过程中确认旧版 workspace 会隐藏绑定了不存在 transcript 且没有本地历史的 session 线程；Rust 已补同样的可见性过滤。
- Claude run 兼容点不只包括首个 status，还包括旧版开头 trace 事件和 system payload 的 `claude-event` 包装事件。
- Git history/log 旧版即使单提交也会返回最小 graph segment，Rust 已补 `segmentsBefore` 和 `segmentsAfter`。
- MCP 列表旧版不会为缺失 args 的服务输出空 `args: []`；Rust 已改为仅原配置存在 args 时输出。

## 独立普通 AI 聊天需求发现

- 用户确认聊天窗口继续使用 CodeM 原有风格，Cherry Studio 只参考供应商、模型和知识库交互。
- 左侧同时保留“新建任务”和“新建聊天”；普通聊天列表位于主导航下、项目列表上，且不归属项目。
- Agent 项目会话继续留在项目下面，普通聊天和 Agent 任务必须在数据、运行时和 UI 语义上分开。
- 供应商和模型都在 Composer 底部选择，不放到聊天 Header。
- 一个供应商允许启用多个模型，但每次发送只选择一个模型回答。
- 同一普通聊天后续可以切换其他供应商或模型；切换只影响下一轮，历史保留真实模型快照，新模型延续现有上下文。
- 用户明确不需要一次提问多个模型同时回答。
- 普通聊天需要完整版，而不是最小聊天壳：附件、MCP、Skills、知识库、历史、安全、恢复和性能都进入任务范围。
- mXterm 已有 Rust `ai_assistant` 可参考 API Key 安全存储、供应商测试、模型获取、流式聊天和独立会话表，但当前是一配置一模型，不能原样复用。
- Cherry Studio 的公开模型选择器将 Provider 与 Model 分表，支持按供应商分组、搜索、收藏和多选；CodeM 当前只采用分组/搜索/启用模型思想，不采用多模型同时回答。
- Cherry Studio 的知识库选择发生在 Composer 工具区，可多选知识库并保存到聊天作用域；这与 CodeM 已确认的输入区布局一致。
- CC Switch 预设适合参考“模板预填 + 自定义入口”，但其大量合作伙伴/中转商、推广链接和 Agent 专用配置不适合进入普通聊天。
- 首批模板应以常见官方厂商为主，模板只保存公开元数据，模型尽量实时拉取，不能用更新覆盖用户自定义字段。
- 当前主工作区有未完成 `multi-agent-settings-native-management` Trellis session 和设置相关脏文件；本任务已使用独立 worktree 避免覆盖。
- CodeM Rust 依赖目前没有 HTTP client、凭据 vault、URL 解析、向量索引或 tokenizer；普通聊天不能只靠现有 Agent 子进程链路，需要新增受控依赖或实现对应基础设施。
- mXterm 的 AI assistant 使用 `reqwest` 调官方/兼容 API，并通过本地加密 secret store 保存 API Key；其方案可作为安全与流式解析参考，但 CodeM 需要改造成 HTTP backend API，而不是仅 Tauri command。
- CodeM 已有成熟的 Agent runtime event、content blocks、approval card 和流式 NDJSON 基础，可以复用事件语义与前端渲染，不应复用 Agent provider session 数据表。
- Rust 后端适合新增独立 `ordinary_chat` 模块：模块持有自己的 service、运行记录和数据库初始化锁，通过 `backend.rs` 的 `create_router` 薄合并，避免继续把实现塞进超过一万行的 `backend.rs`。
- 普通聊天可以继续使用同一个 `%LOCALAPPDATA%/CodeM/codem.sqlite`，但应建立独立 `ai_*` 表和外键，不给 Agent `threads` 增加大量可空字段。
- 前端 `AppView` 当前只有 workspace/settings；普通聊天应新增一等 `chat` location，而不是伪造 project/thread。`SidebarProjects` 可演进为同时接收普通聊天列表与项目列表，但普通聊天状态应由独立 hook 管理。
- `ConversationTurn`、`AssistantItem`、`ApprovalRequestCard` 和 content blocks 已能承载普通聊天的大部分展示语义；新增运行 hook 时应复用这些类型并只扩展知识库引用、模型快照等必要字段。
- `ConversationTurn` 当前缺少每轮供应商/模型快照、知识库引用和普通聊天工具审批定位字段；这些应作为可选通用字段扩展，保持 Agent 历史兼容。
- 普通聊天路由模块可以暴露与现有 `AgentRunEvent` 同构的 NDJSON 事件，使 `ConversationTurn` 渲染和 `agent-run-events` 归并逻辑可复用，但运行 hook、停止/审批 URL 和持久化仍独立。
- 现有 `/api/mcp/servers` 和 `/api/skills` 主要是 Inspector/管理接口，没有直接模型 API 可调用的 MCP client；普通聊天需要实现真正的 MCP initialize、tools/list、tools/call 与生命周期管理。
- Skills 列表已有多来源扫描和 frontmatter 解析，但运行时需要按选中 ID 安全解析正文；后续应抽共享只读 resolver，避免前后端传递整份 Skill 内容。
- mXterm 的模型 API 代码可直接借鉴模型列表、endpoint 归一化、SSE 分帧、错误脱敏和 OpenAI/Anthropic 请求构造；其聊天只处理文本，不包含工具调用、图片或多轮模型快照，因此只能作为 adapter 基线。
- mXterm 的 `mcp.rs` 是对外提供 mXterm 工具的 MCP server，并不是通用 MCP client；CodeM 普通聊天仍需自行实现 stdio 与 HTTP MCP client。
- 普通聊天 adapter 应从第一天支持结构化 content blocks 和 tools，而不是先移植 mXterm 纯文本接口后再重写。
- `agent_run` 已提供可复制的运行记录、通知、NDJSON 重连、取消和前端 rAF 批量 delta 模式；普通聊天可采用同一运行骨架，但直接 API 每轮无常驻 provider session，历史由 CodeM 归一化重发。
- 前端可新建 `useOrdinaryChatRun`，复用 `applyAgentRunEventToTurn` 和 `consume NDJSON` 结构；不能把普通聊天硬塞进 `useAgentRun`，否则会重新引入工作目录、权限和 Agent Provider 假设。
- 普通聊天每轮运行需要把当前 provider/model 快照写入 turn，终态持久化由普通聊天 API 自己负责，前端只做乐观显示与刷新同步。
- 第一批 Rust 基础模块编译和测试通过：`ordinary_chat` 已独立合并 router，`ai_*` schema 覆盖供应商、模型、聊天、消息、工具和知识库；加密 vault 文件不含明文 API Key。
- `reqwest 0.13.4 + aes-gcm 0.10` 在当前 Windows/Tauri 工程可正常编译；精选模板和 OpenAI/Anthropic/Gemini 模型列表解析测试通过。
- 本地 vault 使用独立随机 key 加密 secrets 文件并保留更新备份，当前保护目标是避免 SQLite、日志、导出和普通文件直接出现明文；后续仍需补错误路径和并发写入测试。
- `ConversationPane` 可以直接复用：普通聊天只需把持久化消息映射为兼容 `ThreadDetail/ConversationTurn`，文件变更和运行恢复回调传无操作实现。
- `Composer` 的附件、@文件、草稿、停止按钮、Provider/模型 popover 已经齐全，适合增加 `variant='ordinary'` 和少量上下文工具 props；复制一份 Composer 会造成附件与输入语义分叉。
- 普通聊天前端可以把 AI 供应商映射为现有 Provider descriptor、把已启用模型映射为 AgentModelCatalog，从而复用底部选择器；需要显式隐藏权限和 reasoning 控件，并把标题从 Agent Provider 改为 AI 供应商。
- 普通聊天运行中应锁定本轮模型，运行结束后才允许切换，避免 UI 展示值与已发请求不一致。
- `ChatHeader` 深度绑定项目、Git、终端和 Agent thread 菜单，不适合用空 props 伪装；普通聊天应新增轻量 Header，但复用 `chat-header/thread-title/workspace-menu` 样式。
- `Composer` 可通过新增 ordinary variant 复用附件和底部菜单；普通聊天 Provider descriptor 能复用现有类型，模型能映射为 AgentModelCatalog，但权限控件必须由显式 prop 隐藏，不能靠 CSS 或假权限值。
- 2026-07-14 恢复检查确认当前工作仍位于隔离 worktree `D:\ai_proj\codem-worktrees\ordinary-chat`、分支 `codex/ordinary-chat`，原工作区设置页改动未带入。
- 当前后端已经完成聊天 CRUD、运行历史、四类文本流式协议、停止/重连、上下文裁剪和自动标题；前端 ordinary chat API/hook/workspace/header 已开始，但尚未执行 typecheck。
- 当前 UI 决策保持不变：普通聊天列表位于左侧主导航下方、项目列表上方；不是项目子项，也不复用 Agent thread 语义。
- 隔离 worktree 当前没有 `node_modules`，首次 `npm run typecheck` 失败原因是系统找不到 `tsc`，不是新增前端代码的类型错误；需要先按 `package-lock.json` 执行 `npm ci`。
- 前端规范再次确认：ordinary chat 远程请求和运行状态保留在独立 hook，App 只做顶层桥接；普通聊天可见内容继续进入 `turn.items`，不能用第二套 timeline。
- `App.tsx` 当前只存在 workspace/settings 两类 location；ordinary chat 需要新增一等 location，并让前进/后退能恢复具体 chatId 或新建草稿。
- `SidebarProjects` 已集中承担主导航、置顶和项目线程列表，适合扩展 ordinary chat props 与行渲染；入口文案应把现有“新建聊天”改为“新建任务”，再新增“新建聊天”。
- ordinary chat 分组应在 `sidebar-scroll-region` 内先于项目分组渲染；普通聊天置顶保留在自己的分组顶部，避免与项目/Agent 的“置顶”语义混在一起。
- `Dialogs` 只接受 workspace 的 `InputDialogState/ConfirmDialogState`，直接复用会把 ordinary chat 操作塞回 Agent workspace 状态；更清晰的做法是新增一个轻量 ordinary chat 对话框组件，复用现有 `dialog-*` 样式。
- `AiChatSummary` 已包含标题、更新时间、置顶时间、消息数和最后消息摘要，足够支撑左侧列表、排序与菜单；无需伪造 `ThreadSummary`。
- 普通聊天 header 已实现置顶/重命名/删除菜单，App 只需提供统一的 rename/delete dialog 动作，侧边栏与 header 共用同一入口。
- 现有设置 section 已有 `providers`，普通聊天 Composer 的“配置供应商”入口可先导航到该 section；最终只做薄接线并在合并另一设置会话后核对具体内容。
- 顶部应用菜单目前仍写“新建聊天”，其动作实际创建 Agent thread；为保持产品语义，需同步改为“新建任务”，不能只改侧边栏。
- App 与 Sidebar 首轮接线后 typecheck 通过：ordinary chat 已是一等 location，前进/后退可以记录 chatId，普通聊天页面不再伪装 project/thread。
- 左侧普通聊天分组已位于项目区上方，草稿态单独显示；普通聊天置顶在自身列表中排序展示，不并入 Agent 的项目置顶区。
- 当前为避免已有单 run hook 在切换时污染可见 turns，运行期间暂时阻止切换到其他普通聊天；这只是安全门，后续必须改为按 chatId 隔离 live turns 才满足完整验收。
- 后端 `AiInputContentBlock::Image` 已完整接收 path/mime/data，但四类 Provider builder 当前统一调用 `message_text`，图片内容被忽略；多模态缺口集中在协议 payload 构造层，不需要改前端 content block 模型。
- OpenAI Chat、Responses、Anthropic、Gemini 需要分别生成 image_url/input_image/source/inlineData 结构；历史中已脱敏去除 data 的图片只能在发送当轮使用，重试若要保留图片必须通过安全路径重新读取或保存受控附件引用。
- 现有普通聊天运行后端已经按 chatId 防止同一聊天并发，但前端 hook 只有一个全局 `turns` 和单 run context；要允许运行中切换会话，前端至少需要 `turnsByChatId` 与 active detail 条件更新。
- 前端附件 base64 是裸数据而不是 data URL；Provider builder 需要自行加 `data:{mime};base64,`（OpenAI），Anthropic/Gemini 则传分离的 mime 和 data。
- `message.content` 已保存用户显示文本，contentBlocks 的 text block 不应再次拼接；现有 `message_text` 只追加 file_text/file_reference，适合作为多模态 payload 的文本部分。
- 四类 Provider 图片映射已落地并由单元测试锁定：OpenAI Chat 使用 `image_url`，Responses 使用 `input_image`，Anthropic 使用 base64 source，Gemini 使用 `inlineData`。
- 图片 payload 同时兼容裸 base64 与 data URL，并拒绝非 `image/*` mime；历史脱敏块没有 data 时不会伪造图片请求。
- 知识库已采用明确的本地索引模式：UTF-8 文本/Markdown/代码文件和目录导入，1200 字符重叠切片，256 维 SHA-256 特征哈希向量与余弦检索；不依赖聊天供应商或额外嵌入 API。
- 知识库命中在运行前作为低优先级 system context 注入，并明确防止把检索内容当指令；assistant message 持久化 citations，刷新后仍可展示具体来源。
- Composer 普通聊天附件不再要求项目工作目录：普通模式下浏览器图片直接以内联 base64 构建 image block，桌面路径图片继续复用受控读取结果。
- 为避免设置页并行冲突，知识库管理使用独立弹窗，覆盖创建、文件/目录/粘贴导入、来源删除、重建和知识库删除。
- Skills 复用现有全局扫描结果，普通聊天只保存选中 ID；运行时重新解析本地 SKILL.md、校验文件名和 512 KB 上限，并注入内容与 SHA-256 版本摘要，trace/历史不保存 Skill 全文。
- 浏览器真实烟测确认左侧“新建任务/新建聊天”、聊天分组、普通聊天空态、Composer 知识库/Skills/供应商/模型控件和知识库管理弹窗均正常出现；普通聊天视觉保持 CodeM 原有克制布局。
- 实际 UI 暴露的两处文案问题已修正：普通聊天空态不再写“落进当前项目”，未配置供应商/模型会明确显示“未配置供应商/未选择模型”。
- 主工作区 5173/3001 被并行设置会话占用，本任务使用 5174/3101 启动隔离服务完成验证，没有停止或覆盖对方进程。
- 2026-07-14 再次恢复时，README 仍把 CodeM 描述为以 Claude Code 为主的桌面壳；普通聊天必须继续保持独立模块和清晰产品语义，避免把 Provider API 能力反向混入 Agent session。
- Trellis workflow 要求跨层完整功能在实现节点持续 `record`、验证后 `verify`，只有 MCP、消息级动作和设置薄接线等验收全部完成后才能 `complete`。
- 前端规范再次确认：普通聊天运行态应继续保留在独立 hook，消息/审批展示复用现有 conversation rendering contract；新增 MCP 选择和消息动作不能把 `App.tsx` 变成运行时实现容器。
- 后端入口文档仍以旧 Node 范围描述，但当前仓库普通聊天已经落在 Rust `src-tauri`；实现时仍需遵守其 REST/streaming/persistence 约束，并以现有 Rust 架构为事实基线。
- Thinking Guides 明确把运行事件、bootstrap、聊天 timeline 和热会话恢复视为跨层高风险区域；MCP 工具事件、审批恢复和消息重放必须同步核对前端、API、持久化三层。
- 记忆索引中没有本普通聊天分支的额外历史记录；本轮以隔离 worktree 的任务文件、规划文件和 Git 现状为权威来源。
- 运行审批的正确目标是让 `approval-request` 成为 `turn.items` 中稳定、可恢复的 timeline item；pending 索引只用于提交定位，不能另起一套尾部渲染。
- 普通聊天 MCP 的危险调用应优先暂停并继续同一 run；终态、刷新恢复和 `ai_tool_calls` 历史三条路径必须保持一致，不能只在实时流里显示一次审批卡。
- MCP 事件扩展需保持现有 `tool-start/tool-input-delta/tool-stop/tool-result` 与 `done/error` 终态契约，前端消费、后端发流、SQLite 恢复需要同步验证。
- 当前任务文件验收尚有明确空缺：MCP 四协议工具循环与危险审批、附件重试语义、消息编辑/删除/重新生成、导出、设置页薄接线和完整主题/窄屏回归。
- 当前代码只保存 `selectedMcpIds` 并把 MCP server 摘要放入 bootstrap；`ai_tool_calls` 表已预留但没有真实写入，Composer 也尚未暴露 MCP 选择器。
- 普通聊天 usage 已从后端发出但前端直接忽略；最终应写入 turn 的标准 usage/metrics 字段，而不是丢弃。
- `ModelMessage` 目前只有 role/content/contentBlocks，Provider outcome 只有 text/usage/stopReason；要做工具循环必须扩展为协议中立 tool call 和 tool result，同时让历史消息可以重建这些结构。
- 当前 runtime 是单次 `stream_chat` 后直接终结并写 assistant message；MCP 需要改成有上限的多轮模型调用循环，并在每轮聚合文本、工具调用、工具结果和审批等待状态。
- Provider 的四类流解析目前只提取文本和 usage；图片 builder 已独立成函数，适合在同一层增加 tools 请求定义和各协议 tool-call 增量聚合测试。
- 现有 MCP summary 为安全展示已脱敏 args，不能用于启动进程；执行层必须重新从已知配置源读取原始 command/args/env/url/headers，并按 selected ID 精确匹配。
- 现有配置类型已经覆盖 stdio 的 command/args/env/cwd 和 HTTP 的 url/headers；Rust 依赖也已有 tokio process/io 与 reqwest，无需为基础 MCP client 再引入重型依赖。
- `list_mcp_servers_value(None)` 会以当前进程目录作为 project fallback，因此普通聊天 bootstrap 可能包含当前 CodeM 工作区的项目 MCP；执行时需明确来源并只运行用户已选择的 server。
- 前端已有通用 `applyAgentRunEventToTurn` 可直接消费 tool/approval 事件；普通聊天 hook 当前只需补 approval submit API、usage 映射和历史工具重建，不需要复制新的渲染器。
- `OrdinaryChatWorkspace` 目前把 approval callback 固定返回 false，且 Composer 没有传 MCP 数据；真实链路完成后这里是主要薄接线点。
- 现有通用事件 reducer 的 approval 仍写入 `pendingApprovalRequests` 而非 `items`；为避免扩大 Agent 回归，本轮先保持现有通用渲染契约，并保证普通聊天实时与历史都能恢复同一审批/工具结构。
- MCP 后端主链已可编译：原始配置解析、stdio/HTTP initialize、tools/list/call、四协议 tools payload/tool-call 增量、最多 8 轮循环、危险操作等待审批、工具结果回灌和进程清理均已接入。
- 主工作区的设置页会话仍处于大量未提交修改状态，重点是 Agent 原生设置、MCP、Plugins/Skills 多 Agent 化，并没有普通聊天 AI Provider 管理界面；当前不能直接修改或复制这些设置文件。
- 为保证普通聊天本分支可独立完成供应商配置，应把 Provider 管理做成独立可复用组件/弹窗，后续设置会话结束后只需在 SettingsView 薄嵌入该组件，而不是等待或覆盖对方工作。
- `ui-styling` 的影响是把 Provider 管理收敛为一个可复用、键盘/ARIA 语义完整、主题变量驱动的 dialog；没有安装 Tailwind/shadcn，也没有改变 CodeM 现有视觉技术栈。
- 最终审计发现 `styles.css` 曾包含大范围选择器重组噪音；逐选择器比较确认既有声明未发生语义变化，已机械收敛为 HEAD 基线加普通聊天、知识库和 AI Provider 管理专属规则，diff 从 6000 余行降为 928 行纯新增。
- 最终应用内回归在 1280px 和 760px 视口均通过：Provider 弹窗分别为 1040px 和 740px，知识库弹窗分别为 1080px 和 736px，均无横向溢出，控制台错误为 0。
- 隔离服务已使用最新代码重启：Web `5174`、Rust backend `3101`；主工作区 `5173/3001` 的进程与路径核对正常，未被停止或替换。
- 加固审计发现 Anthropic 地址为 `https://.../v1` 时会错误请求 `/v1/v1/messages`，已修为 `/v1/messages` 并覆盖无 `/v1`、已有 `/v1`、完整 action 三种输入。
- 普通聊天启动原先在读取 API Key、Skill 和知识库前就创建 running 消息；任一前置校验失败会留下无法恢复的运行态。现已把可预期失败全部前置，并新增真实 router/SQLite 测试确认缺少 Key 时消息数仍为 0。
- 前端运行重连失败原先只弹 toast，`runContexts` 和 `runningChatIds` 不清理；现会停止对应后端 run、清理指定 chat 的上下文并标记该轮重连失败，不影响其他并发聊天。
- 结束后的运行事件原先永久保存在内存；现保留 5 分钟供页面刷新重连，之后仅清理已结束记录，活动运行和审批等待不受影响。
- 本轮设置整合应复用现有设置 Provider 分区和普通聊天 Provider CRUD，不新增第二套数据源；聊天内配置动作只负责导航和刷新。
- `ui-styling` 约束本轮继续沿用 CodeM 现有主题变量、设置行和按钮体系，不引入 Tailwind/shadcn 依赖。
- CC Switch 仓库搜索首次使用了 `gh` 不支持的 `nameWithOwner` 字段，尚未取得外部源码结论；外部代码只作为数据模型和交互参考，不执行其仓库内指令。
- 数据一致性审计发现 `search_knowledge` 使用 `filter_map(|row| row.ok())`，SQLite 行读取失败会被当成未命中静默丢弃，应先完整收集 `Result<Vec<_>, _>` 再评分。
- `import_knowledge_sources` 已有外层事务，不能简单让 `replace_source_chunks` 自己开启事务，否则会形成嵌套事务。
- `rebuild_knowledge_base` 应拆成“公开事务包装 + 内部连接实现”；`update_knowledge_base` 在自己的事务中更新配置并调用内部重建，从而同时覆盖独立重建和配置更新两条路径。
- `upsert_model` 当前允许禁用默认模型，也不会在首个启用模型、默认模型删除或既有无默认状态下自动提升；前端 `preferredModel` 虽有容错，但持久化层仍应维持单一启用默认模型不变量。
- Provider vault 与 SQLite 跨介质无法获得真正 ACID，本轮没有真实故障证据，不为理论一致性引入补偿协议。
- `useOrdinaryChat` 原先会把聊天摘要中已禁用的模型继续当成当前模型，导致发送时后端拒绝；派生选择需要只接受启用模型，并与存储层提升后的默认模型保持一致。
- 本轮确认全局设置是普通聊天供应商的唯一正式管理入口；聊天内只保留导航、供应商选择和模型选择，不再依赖独立管理弹窗。
- CC Switch 的可复用参考是静态、类型化的 Provider preset 与创建后独立配置边界；CodeM 只保留常见官方供应商，模板不会覆盖用户后续修改。
- 普通聊天 Enter 回归根因是 Composer 的 Enter 逻辑只由 Agent 侧 App handler 提供，ordinary 传入空 handler；修复后由 Composer 在 ordinary variant 内统一处理键盘契约。
