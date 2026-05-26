# CodeM 功能与文档差异审查报告

> 审查日期：2025-05-25
> 对比文档：`roadmap.md` + `requirements.md`
> 对比基准：实际代码实现

---

## 一、文档说"未做"但实际已实现的功能

### 1. 设置页（12 个子页面，全部已实现）

文档状态：roadmap P1 标记为"做设置页，至少承载：provider 配置、默认权限、默认模型、工作目录/编辑器配置"

实际已实现远超文档描述：

| 设置页 | 实际功能 |
|---|---|
| **BasicSettings** | 恢复上次选择、自动刷新 Git 状态、默认权限模式、Git 审查忽略规则编辑器 |
| **AppearanceSettings** | 主题（系统/浅色/深色）、强调色（预设+自定义HEX）、窗口材质（Mica/Acrylic等）、界面密度、界面字体/字号、聊天字体/字号、代码字体/字号、侧边栏宽度 |
| **ModelSettings** | 默认模型选择、1M 长上下文变体、自定义模型列表（添加/删除） |
| **OpenWithSettings** | 默认打开工具选择、自动识别工具列表、自定义工具（显示名+命令+参数） |
| **ShortcutsSettings** | 发送消息快捷键（Enter/Ctrl+Enter）、新建聊天/搜索/调试面板自定义快捷键 |
| **GlobalPromptSettings** | 读写 `~/.claude/CLAUDE.md`，textarea 编辑器 |
| **McpSettings** | 完整 MCP 服务器管理（三种作用域、添加/编辑/启停/删除、STDIO/HTTP 配置、四种来源读取） |
| **PluginsSettings** | 插件发现、已安装管理、Marketplace |
| **SkillsSettings** | Skills 概览、搜索过滤、复制路径、解析错误列表 |
| **UsageSettings** | 统计范围选择、汇总卡片（会话数/Token/工具调用/耗时/费用）、趋势图、按提供商/模型/项目分组统计 |
| **WorktreeSettings** | Git 工作树列表管理、新建/打开/复制/切换/删除 |
| **SessionManagementSettings** | 项目分组导航、会话搜索、会话操作（打开/重命名/重置连接/删除）、批量删除、运行时状态轮询 |

### 2. Git 功能（功能非常完整）

文档状态：roadmap P1 "读取并展示项目当前 git 分支"，P1 不做"切换分支/创建分支/merge/rebase/stash"

实际已实现：

| 功能 | 组件 | 状态 |
|---|---|---|
| Git 历史面板（三栏布局） | `GitHistoryPanel.tsx` | 已实现 |
| 分支树（本地/远程/标签） | 同上 | 已实现 |
| 提交列表 + Git Graph SVG 连线 | 同上 | 已实现 |
| 文本搜索、分支选择、作者筛选、日期范围 | 同上 | 已实现 |
| 提交详情（SHA/作者/时间/文件列表） | 同上 | 已实现 |
| 文件 Diff 预览弹窗（Split Viewer） | 同上 | 已实现 |
| 分支比较模式 | 同上 | 已实现 |
| **提交/推送/创建分支对话框** | `GitDialog.tsx` | **已实现（文档说不做）** |
| 变更文件勾选 + Diff 预览 + 提交并推送 | 同上 | 已实现 |

### 3. Worktree 功能

文档状态：roadmap P1 不做"创建永久工作树"，P2 才做

实际已实现：
- `WorktreeCreateDialog.tsx` — 新分支名、基础引用、路径输入、创建后添加为项目
- `WorktreeSettings.tsx` — 完整管理工作树列表（新建/打开/复制/切换/删除）
- 项目右键菜单已有"创建永久工作树"选项

### 4. Right Workbench（右侧工作台）

文档状态：**文档完全未提及此功能**

实际已实现四个 Tab：
- **概览**：项目状态、运行状态、Git 变更数
- **文件**：项目文件树（懒加载）、代码预览（语法高亮）、多标签页、右键菜单
- **审查**：Git 变更文件、可勾选、内嵌提交栏、忽略规则、Diff 预览（统一/左右/全文三种模式）
- **浏览器**：占位 Shell（工具栏 disabled）

### 5. Terminal Dock（终端面板）

文档状态：**文档完全未提及此功能**

实际已实现：
- 基于 xterm.js 的完整终端模拟器
- 多终端标签（新建/关闭/切换）
- 可拖拽调整高度
- PTY 会话管理（通过 Tauri bridge）
- 仅桌面版可用

### 6. Composer 图片附件

文档状态：**文档完全未提及此功能**

实际已实现：
- 图片选择和预览（缩略图+文件名+大小）
- 上传到服务器（DataURL 方式）
- 自动构建 prompt 指令告知 Claude 查看图片

### 7. Clone Repository

文档状态：**文档完全未提及此功能**

实际已实现：
- `CloneRepositoryDialog.tsx` — HTTPS/SSH 地址、保存位置选择、自动推断目录名、错误处理

### 8. MCP Inspector（多来源读取）

文档状态：文档只在 McpSettings 中简单提到

实际已实现 9 种来源读取：
- Claude Code settings.json
- Claude MCP mcp.json
- Claude Code 全局 .claude.json
- Claude CLI 项目级
- Claude Desktop 配置
- Codex TOML
- 项目级 .mcp.json
- 项目级 Claude settings
- Cursor MCP

### 9. Effort 控制和 1M 上下文

文档状态：**文档完全未提及此功能**

实际已实现：
- Composer 中 effort 级别选择器
- 1M 上下文开关
- 后端 `--effort` 参数传递

### 10. Slash Commands 系统

文档状态：**文档未详细描述**

实际已实现：
- 从后端加载命令列表，按项目过滤
- 按来源分组显示（内建/项目与用户/插件与Skill/MCP/CodeM）
- 键盘导航、查询过滤

### 11. Usage 统计面板

文档状态：roadmap P2 提到"更接近 Claude Code TUI / Codex Desktop 的事件与统计展示"

实际已实现完整的统计面板（UsageSettings）：
- 多时间范围汇总（7/30/90天/全部）
- Token / 费用 / 耗时趋势图
- 按提供商/模型/项目分组

---

## 二、数据库表结构与文档不一致

文档定义（`requirements.md` §8.3）：

| 文档表名 | 文档字段 | 差异 |
|---|---|---|
| `projects` | id, name, path, created_at, updated_at | 实际多了 `custom_name` |
| `threads` | id, project_id, title, provider, session_id, working_directory, model, permission_mode, pinned, archived, unread, updated_at | 实际**没有** pinned/archived/unread；多了 custom_title/transcript_path/imported/created_at |
| `provider_sessions` | id, thread_id, provider, session_id, workspace, metadata | **整张表不存在** |
| `messages` | id, thread_id, role, content, status, metrics, created_at | 实际多了 turn_id, turn_sort, item_sort, activity, session_id, phase, started_at_ms, duration_ms, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, context_usage_json, total_cost_usd, pending_approval_requests_json, user_attachments_json |
| `tool_calls` | id, thread_id, message_id, tool_name, input_text, result_text, status, created_at | 实际多了 turn_id, turn_sort, item_sort, tool_sort, tool_id, title, tool_use_id, parent_tool_use_id, is_sidechain, is_error, subtools_json；**没有** message_id |
| `app_state` | key, value | 一致 |
| `panel_state` | organize_by, sort_by, visibility, active_project_id, active_thread_id | **整张表不存在**（用 app_state 存储） |

文档中有但实际不存在的表：
- `provider_sessions`
- `panel_state`

文档中有但实际不存在的字段：
- `threads.pinned`
- `threads.archived`
- `threads.unread`
- `tool_calls.message_id`

实际中有但文档未提及的表：
- `ignored_imported_sessions`

---

## 三、文档描述与实际实现不一致

### 3.1 项目菜单

文档：P1 只做"在资源管理器中打开、修改项目名称、移除"

实际：7 个选项，额外包含"复制路径、获取远端(git fetch)、拉取(git pull)、创建永久工作树"

### 3.2 Git 操作范围

文档：P1 明确说不做"切换分支、创建分支、merge/rebase/stash"

实际：GitDialog 已实现创建分支、提交、推送功能

### 3.3 搜索功能

文档：P1 "搜索轻实现"，P2 "完善搜索和筛选体验"

实际：分散在各模块内已实现——侧边栏搜索（Ctrl+G）、会话管理搜索、Git 历史搜索、文件树筛选、Skill 搜索。但无独立的全局对话全文搜索组件。

### 3.4 线程菜单

文档：P1 做"重命名聊天、复制会话 ID"；P2 做"置顶、归档、标记未读、复制工作目录、Deeplink、派生到本地/工作树、迷你窗口"

实际：只实现了重命名、复制会话 ID、删除。置顶/归档/标记未读均未实现，且数据库 threads 表也没有对应字段。

---

## 四、建议的文档更新动作

### P0 — 立即更新

1. **`roadmap.md` 当前基线**：补充已完成的设置页、Git 功能、Worktree、Terminal Dock、Right Workbench、图片附件、Clone Repository、Effort/1M 控制、Usage 统计面板
2. **`requirements.md` §8.3 数据库表结构**：按实际 schema 更新，删除不存在的表和字段，补充新增的字段
3. **`roadmap.md` P1/P2 优先级**：将已实现的功能从待做列表中移除或标记为已完成

### P1 — 近期补充

4. **`requirements.md` 新增章节**：描述 Right Workbench、Terminal Dock、Composer 附件、Clone Repository、Effort/1M 控制等产品规格
5. **`requirements.md` §4 Claude Code 运行策略**：补充 effort 参数和 1M 上下文的运行规则
6. **线程菜单差异**：确认置顶/归档/标记未读是否仍计划实现，如果计划则需在数据库 threads 表补充对应字段

### P2 — 远期规划

7. **多 Provider 进度**：文档描述的 provider 抽象（Codex/Gemini）目前无代码实现，需确认是否仍是当前方向
8. **全局对话搜索**：当前各模块有局部搜索，但无全局全文检索，需确认是否仍计划独立实现
