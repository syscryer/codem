# CodeM 自动化与浏览器实现计划

## 目标

按 CodeM 现有架构与视觉 token，先实现接近 Codex 桌面端的自动化管理与执行闭环，再实现工作台浏览器闭环；两项功能保持相互独立，不能影响 Agent、普通聊天和现有工作台性能。

## 阶段

| 阶段 | 状态 | 内容 |
|---|---|---|
| 1. 现状与参考调研 | complete | 核对 CodeM 占位入口、数据层、路由和 Codex 实际交互 |
| 2. 自动化设计与任务记录 | complete | 明确模型、调度、执行、通知、编辑与删除边界 |
| 3. 自动化后端与持久化 | complete | SQLite、REST API、调度器、执行记录与应用生命周期 |
| 4. 自动化前端 | complete | 列表、创建/编辑、启停、运行历史、手动运行与状态反馈 |
| 5. 自动化验证 | complete | 单元/集成测试、桌面手工验证、Trellis 完成 |
| 6. 浏览器设计与任务记录 | complete | 明确内嵌浏览器能力、安全边界和工作台交互 |
| 7. 浏览器实现 | complete | 导航、标签、地址栏、刷新、历史、外部打开与状态保持 |
| 8. 浏览器验证与收口 | complete | 测试、桌面验证、文档与 Trellis 完成 |

## 核心约束

- 自动化默认本地持久化、本地调度，只在桌面应用运行时执行。
- 自动化复用 Agent 任务机制，不改变普通聊天机制；创建时明确项目、提示词、Agent、模型/权限和计划。
- 浏览器优先复用现有工作台和 Tauri 能力，不引入高成本常驻渲染或不受控远程执行。
- 视觉全部复用 CodeM 主题变量、统一按钮、菜单、弹层和列表样式。
- 不提交 `CONTEXT.md`；规划文件是否入库在最终提交前按项目卫生决定。

## 验收方向

- 自动化可以创建、编辑、启停、删除、立即运行并查看最近执行结果。
- 调度不会并发重复触发，应用重启后配置与历史仍存在，失败可见。
- 浏览器入口不再是占位，具备可实际使用的桌面浏览体验和清晰错误态。
- 全量前端测试、Rust 测试、类型检查、构建与桌面启动通过。

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|
| Computer Use 获取 Codex 窗口状态时报 `GetCursorPos 0x80070005` | 1 | 停止窗口输入，改用 Codex 自动化接口 schema、本机配置文件和 CodeM 现有设计系统校准 |
| PowerShell 下 `rg src-tauri/src/*.rs` 通配符报路径格式错误 | 1 | 改为 `rg ... src-tauri/src` 让 ripgrep 自己递归，不再使用 shell 通配符 |
| 更新 Trellis 任务时默认模板小节文本不匹配 | 1 | 读取真实任务文件后按现有小节精确补丁 |
| rusqlite 不存在 `BorrowedConnection` trait | 1 | 利用 `Transaction` 到 `Connection` 的解引用，查询 helper 统一接收 `&Connection` |
| 后台线程契约批量补丁未匹配测试调用参数 | 1 | 拆分正式代码与测试调用，按每个调用上下文精确增加参数 |
| `AutomationSchedule` 将 daily/weekdays 合并为一个联合成员，导致 monthly 分支无法正确收窄 | 1 | 将 daily 与 weekdays 拆为独立判别联合成员，不改变持久化 JSON 结构 |
| Claude 自动化提交入口返回 Promise、通用 Agent 返回同步 boolean | 1 | 调度桥接接受两种返回形式并统一 await，保留各自运行机制 |
| Claude 模型状态是 `ClaudeModelInfo` 包装对象而非模型数组 | 1 | 自动化页只传入其 `models` 字段，继续复用主聊天模型探测结果 |
| 自动化样式误用未定义的 `--app-accent`，导致主按钮不可见 | 1 | 统一改用项目真实强调色 token `--accent` 并重新截图验收 |
| 新增 `automation.rs` 未通过 rustfmt 换行规则 | 1 | 运行项目标准 `cargo fmt` 后复验，不手工维护格式差异 |
| 调研时读取了不存在的 `src-tauri/capabilities/default.json` | 1 | 通过 `rg --files` 确认真正文件是 `capabilities/main.json` 后读取 |
| 浏览器 URL 检测把 `localhost:5173` 误判为自定义协议 | 1 | 在协议拒绝前识别 localhost/IP 端口形式，并统一补 `http://` |
| Tauri Manager 没有 `get_webview` 单项方法 | 1 | 使用当前 2.10 API 的 `webviews()` 映射按 label 克隆句柄 |
