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
