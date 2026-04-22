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
  - `command: C:\\Users\\csm\\.local\\bin\\claude.exe`
- 当浏览器连接关闭时，后端现在会主动取消对应 Claude 进程，避免残留后台任务。
- 当前 UI 可以展示 Claude CLI 暴露出来的完整运行事件，包括工具调用和工具结果。
- 模型内部隐藏思考链不属于 CLI 暴露内容，不能也不应在 UI 中伪造展示；可以展示可见状态和事件。
- OpenSpec 对齐后，主界面应以对话流为主，工具调用应作为 assistant turn 内的轻量 step，而不是全局 timeline 大卡片。
- `system/raw/snapshot` 等事件适合进入调试抽屉，避免干扰主对话。
- assistant 正文与工具调用必须按事件到达顺序共同渲染，不能分别渲染正文和工具列表，否则会出现顺序错位。
- 在 CSS grid 消息布局中，assistant 的所有正文和工具内容必须包进同一个右侧内容列，否则后续子元素会被自动排到左侧标签列。
