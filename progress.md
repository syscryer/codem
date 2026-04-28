# Progress

## 2026-04-22

### 会话记录
- 确认当前工作目录目前为空目录。
- 验证本机存在 `claude`、`node`、`npm`。
- 验证 Claude CLI 可返回 `stream-json` 流式输出。
- 确定实现方向为本地 Web UI 包装器。
- 创建了 React + Vite 前端、Express 后端、本地流式桥接与 README。
- 完成依赖安装，并通过 `npm run typecheck`。
- 启动后端 smoke test，确认 `/api/health` 能识别 `claude.exe`。
- 修复了 Windows 下 `shell: true` 带来的参数拼接风险，改为解析真实命令路径后直接启动。
- 增加了连接关闭时的自动取消逻辑，减少孤儿进程风险。
- 将前端从聊天气泡升级为桌面端风格 timeline，展示系统事件、正文、工具调用、工具结果、stderr、snapshot 和完成指标。
- 后端新增结构化事件转发，保留原始 `stream-json` payload 供前端查看。
- 再次通过 `npm run typecheck`，并确认 `/api/health` 正常。

### 下一步
- 如需桌面壳，可在现有项目外包一层 Electron 或 Tauri。
- 如需更像 IDE，可继续加多会话列表、历史记录、本地配置持久化。

### Codex Desktop 类对话流重构
- 已确认当前“大 timeline 卡片”不符合目标体验。
- 下一步将主 UI 改为 turn-based conversation flow。
- 工具调用改为 inline step，调试信息移入抽屉。
- 已完成 turn-based conversation flow 重构：用户消息、Claude 正文和工具步骤聚合到同一轮对话。
- 工具调用改为轻量 inline step，参数与结果默认通过 details 展开。
- `system/raw/snapshot/stderr` 等调试信息已移入右侧调试抽屉。
- 已通过 `npm run typecheck`。
- 根据 Codex Desktop 截图修正输出顺序：assistant 内容现在按事件顺序渲染 `text/tool/text`。
- 修复工具步骤掉入左侧窄列的问题，工具块现在占用 assistant 正文整列。
- 增加底部锚点自动滚动，持续输出时自动滚到最新内容。
- 增加 Enter 发送、Shift+Enter 换行，并规避 IME 组合输入误触发。
- 修复页面整体滚动问题：输入框固定在底部，只有 conversation 内容区内部滚动。
- 增加 assistant 正文 Markdown/GFM 渲染，支持列表、表格、链接、inline code 和 fenced code block。
- 按 Codex Desktop 截图重做整体壳子：左侧项目功能暂置空，右侧 header、composer、状态栏更贴近截图布局。
- composer 增加 permission mode、模型、强度、续聊、麦克风占位和圆形发送/停止按钮。
- 底部状态栏增加 `本地工作` 与 `main` 占位，不读取真实分支。
- 进一步按 Codex 桌面截图校准视觉：增加顶部菜单栏，压缩 header/sidebar/composer 密度，隐藏对话 label，用户消息右对齐。
- 使用 Playwright 打开本地页面、截图比对 2048x1119 视口，并用真实 Enter 发送检查短对话渲染。
- 再次通过 `npm run typecheck`；当时工作目录不是 git 仓库，因此没有执行 `git add`。
- 将 permission mode 从原生 select 改为 Codex 风格自定义浮层：底部橙色权限按钮，上方白色弹出菜单，支持默认权限/完全访问权限切换和选中勾。
- 修复 permission 浮层被 composer 裁切的问题，并用 Playwright 点开菜单截图确认。
- 继续细化 permission 浮层：减小字号、行高、宽度、阴影和圆角，改为 CSS 绘制轻量图标，避免 Unicode 图标显粗。
- 修复 composer `overflow: visible` 后 textarea 背景破坏圆角的问题，为 input 与 toolbar 分别补回上下圆角。
- 根据本机 `claude --help` 将 permission 菜单恢复为 Claude Code 真实 `--permission-mode` choices：`acceptEdits`、`auto`、`bypassPermissions`、`default`、`dontAsk`、`plan`。
- 用 Playwright 点开 permission 菜单确认 6 个 CC 权限均可见，且弹窗不再撑坏 composer。
- 实现 Claude Code 模型切换：后端新增 `/api/claude/models`，从 `claude --help` 的 `--model` 描述读取 alias，目前解析为 `sonnet`、`opus`。
- 前端启动时读取 CC 模型列表，移除 composer 右侧“已连接”和思考等级选择，只保留模型选择、占位按钮和发送/停止。
- 运行 Claude 时将当前模型通过 `--model <model>` 传给 Claude Code；已用 Playwright 切换到 Opus 并截图确认。
- 将模型选择从原生 select 改为 Codex 风格自定义浮层：默认收起态为轻量文本 + 下箭头，展开态为右对齐白色菜单，包含“模型”标题和选中勾。
- 根据用户提供的 Codex 默认态截图，去掉模型默认灰色 pill 背景，仅在展开/hover 时显示浅灰底；已用 Playwright 打开模型菜单截图确认。
- 统一 composer 内权限和模型按钮的下拉箭头：移除字符 `⌄`，改用 CSS 绘制 chevron，解决字体 baseline 导致的上下不齐。
- 模型列表收窄为两项：第一项 `默认`，第二项读取 `~/.claude/settings.json` 中 `env.ANTHROPIC_MODEL` 的当前配置值。
- 默认项选中时发送请求不传 `--model`，但 composer 收起态展示当前实际配置模型。
- 引入 `lucide-react` 作为统一 SVG 图标库，替换 header、sidebar、composer、footer 中的 Unicode 字符图标，减少 Windows 字体导致的粗细和 baseline 偏移。
- 为 SVG 图标补充统一 CSS：固定 stroke、居中布局、header/footer chevron 继续用 CSS 绘制；已通过 Playwright 截图检查默认态与权限菜单展开态。
- 去掉“续聊”显式开关，当前线程默认续聊；新建聊天改为创建新线程并保留旧线程，行为更接近 Codex Desktop。
- 新增 `requirements.md`，固化当前产品目标、Claude Code 能力边界、多 provider 方向、SQLite 持久化方向与后续阶段计划，避免会话压缩后丢失上下文。
- 继续整理左侧项目区规范：明确 `Project` 与 Claude Code 目录工作区一一对应，`Rename project` 只改显示名不改实际目录。
- 补充项目区 Header、项目菜单、线程菜单和 P1 范围：Header 三按钮都实现；项目菜单先做打开目录 / 修改名称 / 移除；线程菜单先做重命名聊天 / 复制会话 ID。
- 补充 Claude Code session 导入策略：P1 先做导入 session、显示 session name、复制 session ID、CodeM 内部 rename；不反写 Claude Code 本地 session 名称。
- 补充 P1 范围：项目读取并展示当前 git 分支；左侧主导航中“新建聊天”真实实现，“搜索”轻实现，“插件/自动化”先占位。
- 新增服务端 SQLite 存储层，数据库位于 `%LOCALAPPDATA%\\CodeM\\codem.sqlite`，落地 `projects`、`threads`、`app_state` 基础表。
- 新增 Claude Code session 导入：启动时扫描 `~/.claude/projects/`，按目录工作区合并为项目，按 `sessionId` 导入为线程。
- 新增项目区真实数据接口：`/api/workspace/bootstrap`、项目 CRUD、线程创建/更新、线程历史读取、项目目录打开。
- 前端从内存假数据切换为真实 `projects + threads + panelState` 数据流，左侧显示导入项目、线程、git 分支和基础菜单。
- 线程历史现在可从 Claude Code transcript 解析恢复，选中旧 session 可回放用户与 assistant 正文，以及基础工具步骤。
- 已通过 `npm run typecheck`，并验证 `/api/workspace/bootstrap` 与 `/api/threads/:id/history` 返回真实导入结果。
- SQLite 新增 `messages`、`tool_calls` 表，线程历史不再只靠 transcript 临时解析；读取历史时会把 transcript 结果缓存落库。
- 新增 `/api/threads/:id/history` 写接口，前端在会话完成、停止或报错后会把当前 turns 持久化到 SQLite。
- 优化 Claude Code session 标题导入规则：优先读取 transcript 中的 `sessionName` / `displayName` / `title` / `slug`，再回退到首条有效 prompt 文本，并过滤本地命令元信息。
- 去掉项目和线程操作里的 `prompt / confirm / alert`，改为应用内输入弹层、确认弹层和 toast，新增项目、重命名、移除、复制会话 ID 的交互更贴近桌面端。
- 已再次通过 `npm run typecheck`，并验证新加的线程历史写接口可返回 `200`。

## 2026-04-24

### 会话历史与来源收敛

- 修复历史加载晚返回覆盖本地新 turn：加载结果按 turn id 与当前状态合并，避免正在运行或刚创建的 turn 消失。
- 修复空 `done` 被当成成功回复：空结果不再追加空文本项，无正文和工具输出时落为 `stopped`，活动文案为“运行结束但没有返回正文”。
- 修复保存历史时伪造空 assistant 文本：持久化时只写入非空文本项，`activity` 只作为元信息保留。
- 修复工具结果回挂：`tool_result` 找不到精确 `toolUseId` 时回挂最近未有结果的工具；历史修复时也会把孤立结果合并回前一个未完成工具。
- 修复 Agent/Task 工具标题：优先从 `description`、`prompt`、`subagent_type` 提取摘要，例如 `Agent(全面代码 review)`。
- 服务端实时流过滤 `isSidechain`，transcript 解析跳过 `isSidechain` / `isMeta`，避免子 Agent 内部步骤和技能注入内容混入主对话。
- 清理旧格式 transcript 中的 `<thinking>...</thinking>`、`answer for user question` 和 meta continuation 的 `No response requested.`。
- Claude Code 会话列表改为以真实存在的 `~/.claude/projects/**/*.jsonl` 为单一来源：已绑定 `session_id` 但 jsonl 不存在的旧缓存线程不再展示，也不从 SQLite 旧数据推断标题或历史。
- 导入时跳过 `agent-*.jsonl` 子 Agent 文件。
- 清理标题为 `1` 的 Claude Code 会话 62 条，其中 24 条删除了对应 jsonl，38 条只清理旧索引；已写入 ignored，防止重新导入。

## 2026-04-25

### 待后续优化

- 活动会话在 AI 回复进行中向上滚动会有发涩感；非运行中的同类会话滚动正常，说明问题集中在运行态高频 UI 更新。
- 初步定位为 delta 按帧更新当前 turn、Markdown 重解析、滚动跟随测量和 raw/debug 事件状态更新叠加导致。
- 暂不修复，后续可优先降低运行态渲染频率、减少 Markdown 重解析，并调整自动贴底逻辑。

## 2026-04-26

### AI 返回信息解析补齐

- 对照另一套参考项目的消息解析范围，确认 CodeM 不迁移工具注册体系，继续扩展现有 `ToolStep` 模型。
- 前后端事件增加 `parentToolUseId`、`isSidechain` 和 `subagent-delta`，用于保留子代理消息。
- 实时流不再直接丢弃 `isSidechain`，改为将子代理文本和子工具挂到父 `Agent/Task` 工具详情中。
- transcript 历史解析同步支持 sidechain 归组；SQLite `tool_calls` 增加子工具和子消息 JSON 字段。
- 工具标题和前端结构化预览补充覆盖：`EnterPlanMode`、`TodoRead`、`UpdatePlan`、`LS`、`Grep`、`Glob`、`WebSearch`、`WebFetch`、`BashOutput`、`KillShell`、`TaskOutput`、`TaskCreate/TaskUpdate/TaskList/TaskGet`、`MultiEdit`、`ViewImage`、MCP 结果。
- 增强孤立 `tool_result` 修复，优先按 `toolUseId` 回挂，减少多工具并发或历史恢复时错挂。
- 已运行 `npm run typecheck`，结果通过。
- 已重启 `npm run dev`，后端监听 `http://127.0.0.1:3001`，前端监听 `http://127.0.0.1:5173/`。
- 已验证 `/api/health` 和 `/api/workspace/bootstrap` 正常，浏览器打开 `CodeM` 无 console error。
- 增加连续 `Read` 工具的批量折叠展示：多个连续读取默认合并为“批量读取 N 个文件”，展开后可查看每个 Read 的原始详情。
- 已再次运行 `npm run typecheck`，结果通过；浏览器页面可正常加载。
