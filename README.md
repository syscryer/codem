# CodeM

一个最小可用的本地 UI，用来在浏览器里调用本机 `Claude Code`。

## 当前能力

- 输入 prompt 并调用 `claude`
- 实时展示 `stream-json` 返回内容
- 自动记录并复用线程级 `sessionId`
- 支持切换工作目录
- 支持停止当前运行
- 支持模型选择，并在切换非运行线程时同步当前 provider 配置
- 权限菜单收敛为“默认 / 自动执行 / 完全访问”三档，内部仍兼容 Claude Code 的历史权限值
- 按 turn 聚合展示对话，用户输入和 Claude 正文保持主线连续
- Claude 正文支持 Markdown / GFM 渲染，包括表格、列表、代码块和链接
- 工具调用以内联步骤展示，参数和结果默认折叠
- `TodoWrite` 会渲染为计划任务卡片；当前未完成任务会固定在输入框上方，完成后自动收起
- 支持 Plan 确认、权限审批和 AI 提问卡片；需要用户决策时会暂停当前运行，避免错误结果继续污染上下文
- 支持运行中继续输入，后续 prompt 会进入当前线程队列，也可以从队列中移除
- 运行中会展示接近 Claude Code TUI 的 `Thinking...` / `Computing...` 状态、耗时和输出 token
- 运行中 token 统计使用本地估算平滑展示，结束后回落到真实统计
- 工具调用行改为 `Bash(...)` / `Read(...)` / `Edit(...)` 等紧凑 TUI 风格，并保留错误摘要
- system/raw/snapshot/stderr 等调试信息放入右侧调试抽屉
- 可查看最近的原始事件流和 assistant message snapshot
- 支持保留多个线程，新建聊天不会清空旧线程
- 启动时自动从 Claude Code 本地 session 缓存导入项目与聊天
- 左侧项目与 Claude Code 目录工作区一一对应
- 支持项目级 git 分支读取与展示
- 支持项目级操作：打开目录、修改显示名、移除
- 支持线程级操作：重命名聊天、复制会话 ID
- 当前项目与线程选择会持久化到本地 SQLite
- 线程消息与工具调用会持久化到本地 SQLite
- 新增项目、重命名、移除、复制会话 ID 使用应用内弹层和 toast，不再依赖浏览器原生弹窗
- 后端优先复用热会话 stdin runtime；遇到 Plan、审批、AI 提问等人类输入节点时保留可写 runtime，并通过对应 tool result 继续同一轮运行

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- Claude 调用：本机 `claude` CLI
- 本地持久化：Node.js 内置 `node:sqlite`

## 规范与协作

- 开发规范入口：`.trellis/workflow.md`
- frontend 规范：`.trellis/spec/frontend/`
- backend 规范：`.trellis/spec/backend/`
- 思考指南：`.trellis/spec/guides/`
- 后续任务沉淀：`.trellis/tasks/`
- 行为提案与变更记录：`openspec/README.md`
- 后续开发路线图：`roadmap.md`

当前仓库采用的是轻量 `.trellis` 结构：

- 已提供规范目录和任务目录骨架
- 暂未引入 `.trellis/scripts/`、developer 初始化、session record 自动化
- 适合当前阶段先约束重构和功能开发，再按需要逐步补齐流程能力

## 运行方式

```bash
npm install
npm run dev
```

启动后：

- 前端地址：`http://127.0.0.1:5173`
- 后端地址：`http://127.0.0.1:3001`
- 本地数据库：`%LOCALAPPDATA%\\CodeM\\codem.sqlite`

## 使用说明

1. 确保当前机器已经能在终端里执行 `claude --help`
2. 在左侧填写工作目录
3. 输入 prompt 后点击“发送给 Claude”
4. 当前线程默认续聊；点击“新建聊天”会创建新线程，但不会删除旧线程

## 设计说明

- 现在先做本地 Web UI，而不是 Electron / Tauri 壳
- 这样可以更快验证“Claude CLI 是否能被稳定包装”
- 如果后面确认交互可行，再包成桌面应用会比较顺手
- 数据模型与持久化方向已经开始按多 provider 演进，后续不只支持 `Claude Code`
- 规范层使用轻量 `.trellis`，功能提案层预留 `openspec/`

## 已知边界

- Claude CLI 参数如果未来变动，后端桥接需要同步调整
- “完全访问”对应 Claude Code 的跳过权限模式，风险较高，只建议在可信目录下使用
- Plan / 审批 / AI 提问会暂停等待用户决策；批准、拒绝或回答后优先写回同一运行，旧版不可写 runtime 才回落到同 `sessionId` 续跑
- 线程标题的 Claude Code 侧名称目前只做导入，不反写 Claude Code 本地 session 名称
- 线程历史持久化以 CodeM 自己的 SQLite 为主，Claude transcript 作为导入与补录来源
- 排序 / 显示按钮、插件、自动化目前仍以基础占位为主
- 模型内部隐藏思考链不会展示；界面只展示 Claude CLI 在 `stream-json` 中实际暴露的事件
- `thinking_delta` 会渲染为默认折叠的 Thinking 块；模型未暴露的隐藏思考链不会展示
- 详细需求与演进路线见 `requirements.md`
