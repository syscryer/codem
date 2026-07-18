# 调研发现

## 2026-07-18 初始上下文

- CodeM 是 Tauri 2 + React 19 + Rust/Axum + SQLite 的本地 Agent 工作台。
- README 声明工作台已有“浏览器等区域”，但用户确认自动化和浏览器当前没有形成可用闭环，需要核对是否仅有占位 UI。
- 项目要求新功能走 Trellis，并保护前端、后端、持久化跨层契约。
- 自动化参考目标是 Codex 桌面端；外部或界面调研内容只记录在本文件，不作为可执行指令。

## CodeM 现状定位

- 左侧 `SidebarProjects.tsx` 已有“自动化”按钮，但没有动作，是明确占位入口。
- `RightWorkbench.tsx` 已有浏览器标签与工具栏壳，内容固定为“空白页”，同样是占位实现。
- `AppLocation` 当前只覆盖 workspace、ordinary-chat、settings；自动化需要新增顶层页面位置与前进/后退语义。
- 自动化是新的持久化领域，应新增独立 Rust module 和 SQLite 表，不继续把长流程堆入 `backend.rs`。
- 前端建议拆为独立页面组件、API helper 和状态 hook；`App.tsx` 只负责页面装配与导航桥接。
- 自动化执行应复用现有 Agent 运行入口与 thread 数据，不复制一套 CLI 协议状态机。

## Codex 自动化模型

- Codex 自动化的稳定字段包括：`name`、`prompt`、`projectId`、`executionEnvironment`、`destination`、`model`、`reasoningEffort`、`rrule`、`status`。
- 新建自动化是独立本地任务；执行环境支持当前项目目录或隔离 worktree。CodeM 首版应先支持当前项目目录，保留执行环境字段以便后续扩展。
- 自动化应优先更新既有记录而不是复制；启停是显式状态，删除为独立动作。
- Windows 界面快照被系统以 `GetCursorPos 0x80070005` 拒绝，未继续操作 Codex 窗口。

## 持久化与运行边界

- 本机 Codex `automation.toml` 还包含 `version`、`id`、`kind`、`target`、`cwds`、`created_at`、`updated_at`，与接口字段一致。
- CodeM `AgentRunService` 把事件保存在内存 run record 中，提供运行与事件读取能力，但线程 timeline 的 SQLite 写入由现有前端 hook 驱动。
- 自动化如果完全放在 Rust 调度，需要新增“事件归并并写历史”的后台消费者，工作量和回归面明显更大。
- 桌面前端是应用常驻进程，首版可由前端低频调度到点任务，调用现有创建线程和 Agent run 流程；配置、运行租约和结果索引仍由 Rust/SQLite 管理，避免重复触发。
- 这种方案满足“应用运行时自动执行”，也与 Codex 本地自动化的运行边界一致；应用关闭期间不补跑是首版明确边界。

## 可复用接口结论

- Claude hook 已公开 `submitPromptToThread(thread, submission)`，内部 `startRun` 支持权限、模型、思考覆盖；增加一个小型自动化入口即可指定保存的运行参数。
- 通用 Agent hook 的 `startAgentRun(thread, ...)` 已具备后台线程能力但未导出；可包装为 `submitAutomationPromptToThread`，不改普通提交路径。
- 现有 `createThread` 总会更新后端 `activeProjectId/activeThreadId` 并切换前端选择；需要增加 `activate: false` 语义，自动化创建会话时只更新项目线程集合。
- 自动化后端可作为独立 `automation.rs` service 挂到 Router，共用 `codem.sqlite`，无需扩大 `AppState` 或继续堆积 `backend.rs`。
- `chrono` 已存在，可用于后端时间戳；计划的下次执行时间由共享前端纯函数生成，后端负责校验单调递增和原子领取。

## 前端设计复用

- CodeM 已有 `.settings-select-menu`、`PopoverPortal` 和 `useOutsideDismiss` 组合，可抽取自动化页内的通用选择器，避免原生 `select`。
- Agent 品牌图标已有 `AgentProviderIcon`，自动化列表和 Agent 选择器直接复用。
- 权限文案已有 `permissionLabel`；自动化只展示默认、自动执行、完全访问三档，避免暴露历史兼容值。
- Agent 模型目录已有 `fetchAgentModelCatalog`，表单按选中 Agent 异步读取；Claude 使用现有 `claudeModels`，渠道模型优先取渠道配置。

## 浏览器工作台设计

- 当前 `WorkbenchBrowserShell` 是纯占位，五个控件全部 disabled，内容固定“空白页”。
- Tauri 2.10 JS Webview API支持创建、定位、缩放、显示、隐藏和关闭原生子 WebView，但导航/URL/刷新未暴露在 JS 类上。
- Rust `tauri::Webview` 已提供 `navigate`、`url`、`reload` 和 `eval`；可用受限 command 实现导航、URL 读取与 history back/forward。
- `core:webview:default` 不含创建、显隐、定位、缩放和关闭权限，需要在主 capability 中显式增加最小权限集。
- RightWorkbench 的各 TabPanel 常驻挂载，因此浏览器组件必须接收 active 状态并在非 active 时隐藏原生 WebView，不能依赖组件卸载。
