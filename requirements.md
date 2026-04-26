# CodeM 需求与演进文档

## 1. 项目定位

CodeM 是一个本地桌面风格 AI coding workspace，当前以 Web UI 形式快速迭代，核心目标是：

- 用接近 Codex Desktop 的界面承接本机 AI coding agent 的输出与交互
- 第一阶段优先稳定接入 `Claude Code`
- 后续逐步适配 `Codex`、`Gemini`
- 长期作为自己和同事日常可用的本地工具，而不是一次性 demo

当前实现仍是本地 Web UI，但产品方向按“长期可用桌面工具”设计。

## 2. 已确认的产品目标

### 2.1 交互目标

- 整体视觉风格优先接近 Codex Desktop，默认白色主题
- 左侧为项目与线程区域，右侧为聊天与运行详情区域
- 输入框固定底部，仅对话内容区滚动
- assistant 正文按 Markdown/GFM 渲染
- 工具调用以内联步骤展示，不做笨重的大日志框
- 对话默认续聊，不再提供单独“续聊”开关
- 新建聊天会创建新线程，但不会删除旧线程

### 2.2 能力目标

- 支持调用本机 `Claude Code`
- 支持流式事件显示
- 支持权限模式切换
- 支持模型切换
- 支持停止运行
- 支持一个项目下多个线程
- 支持线程与底层 provider session 绑定
- 支持本地持久化恢复项目、线程、消息和会话状态

### 2.3 长期目标

- 不只服务 `Claude Code`
- 后续适配 `Codex`、`Gemini`
- 数据模型、存储结构、前端状态都不能写死为 Claude 专用

## 3. 当前已落地内容

- 本地前端：React + Vite
- 本地后端桥接：Node.js + Express
- 已接入 `claude` CLI 的 `stream-json` 输出
- 已支持工具步骤内联展示
- 已支持 Markdown/GFM 渲染
- 已支持 Claude Code 权限模式，界面收敛展示为“默认 / 自动执行 / 完全访问”
- 已支持从 `~/.claude/settings.json` 读取当前模型
- 已支持多线程保留，新建聊天不会清空旧线程
- 已支持真实项目、线程、消息和工具调用的 SQLite 持久化
- 已支持从 Claude Code 本地 session 缓存导入项目与聊天
- 已支持 Plan 确认、权限审批、AI 提问卡片和运行暂停恢复
- 已支持 `TodoWrite` 计划任务卡片和底部当前任务固定展示
- 已支持运行中后续 prompt 队列，并可移除未执行的排队项
- 已支持切换非运行线程时刷新模型 / provider 配置

## 4. Claude Code 相关已确认事实

以下内容来自本机 `claude --help` 与官方文档，属于当前开发必须遵守的能力边界。

### 4.1 Claude Code 已确认支持

- 会话相关
  - `--resume`
  - `--continue`
  - `--fork-session`
  - `--session-id`
  - `--no-session-persistence`
- 输出相关
  - `--output-format text/json/stream-json`
  - `--include-partial-messages`
  - `--include-hook-events`
- 权限相关
  - `acceptEdits`
  - `auto`
  - `bypassPermissions`
  - `default`
  - `dontAsk`
  - `plan`
- 工作区相关
  - `--add-dir`
  - `--worktree`
  - `--tmux`
  - `--ide`
- 扩展相关
  - `mcp`
  - `plugin`
  - `agents`
- 模型相关
  - `--model`
- 配置相关
  - `--settings`
  - `--setting-sources`

### 4.2 当前对 CC 的产品理解

- CodeM 不应该伪造 Claude 未输出的“思考链”
- UI 只展示 CLI 实际暴露的内容：
  - 正文文本
  - 工具调用
  - 工具参数增量
  - 工具结果
  - 状态事件
  - 错误与结束事件
- 线程级会话需要保留 `sessionId`
- 后续做项目栏时，要把线程与工作区、provider session 一起考虑，而不是单纯聊天列表

### 4.3 当前 Claude Code 运行策略

CodeM 当前对 Claude Code 采用“热会话优先，人工节点暂停”的运行策略。

默认策略：

- 普通连续对话优先复用同一条 `stdin + stream-json` runtime，降低重新启动 CLI 的成本
- `workspace`、`permissionMode`、`model` 与运行中的 runtime 一致时，后续 prompt 通过 stdin 注入
- 运行中的后续 prompt 先进入当前线程队列；真正执行前可以从队列移除

暂停策略：

- 出现 `AskUserQuestion` / `RequestUserInput` 时，后端向前端发出 AI 提问卡片，并结束当前 runtime
- 出现 `ExitPlanMode` 时，后端转成“计划待确认”审批卡片，并结束当前 runtime
- 出现权限审批或 Claude Code 安全策略拦截时，后端转成审批卡片，并结束当前 runtime
- 暂停时保留当前 `sessionId`，用户批准、拒绝或补充输入后，用同一 session 冷恢复继续

这样做的取舍：

- 优点是不会让 Claude Code 自动生成的错误 tool result 继续污染当前上下文
- 代价是 Plan / 审批 / AI 提问节点会牺牲一次热会话复用
- 如果后续 Claude Code 提供更稳定的原生 stdin 审批协议，再评估改为不中断 runtime 的交互模型

### 4.4 权限模式产品规则

Claude Code 内部仍兼容这些权限值：

- `default`
- `auto`
- `bypassPermissions`
- `acceptEdits`
- `dontAsk`
- `plan`

但 CodeM 的用户菜单只展示三档：

- `默认`：对应 `default`
- `自动执行`：对应 `auto`
- `完全访问`：对应 `bypassPermissions`

规则：

- 历史线程如果保存了隐藏权限值，切换到该线程时前端回落显示为 `默认`
- 普通审批批准后可以临时用 `完全访问` 继续当前任务
- Plan 批准不自动切到 `完全访问`，只表达“计划已批准，可以开始执行”
- “完全访问”风险较高，只应在可信目录下使用

### 4.5 模型与 provider 同步规则

- 线程保存自己的 `model` 与 `permissionMode`
- 切换到非运行线程时，界面应按线程元数据恢复模型选择
- 如果当前没有热运行，切换线程时可以刷新 `/api/claude/models`，以反映外部调整的 API 供应商或默认模型
- 热会话运行中不强制刷新模型列表，避免影响当前运行；运行结束后再刷新
- 模型触发器展示当前生效模型；选择 `默认` 时允许后端读取当前 provider 配置

## 5. 多 Provider 方向

未来目标不仅是 `Claude Code`，因此从现在开始要采用统一领域模型。

### 5.1 Provider 范围

- `claude-code`
- `codex`
- `gemini`

### 5.2 统一抽象原则

UI 和数据库不直接依赖某一家 provider 的原始事件格式，而是依赖统一模型：

- 项目 `project`
- 线程 `thread`
- 运行 `run`
- 消息 `message`
- 工具调用 `tool_call`
- provider 会话 `provider_session`

### 5.3 必须拆开的两个概念

- 产品线程 `thread`
- 底层 provider 会话 `provider session`

原因：

- 一个产品线程要能绑定某个 provider 的真实 session
- 将来 thread 可能需要切换 provider
- 不同 provider 的 session 结构不同，不能直接等同于产品线程

## 6. 项目、工作区与线程模型

### 6.1 Project 与 Claude Code 工作区的关系

CodeM 中的 `Project` 与 `Claude Code` 的目录工作区一一对应。

这里的“工作区”指本地目录上下文，而不是组织级 workspace。

也就是说：

- 一个 `Project` 对应一个真实目录
- `Project.path` 是项目的真实工作区路径
- 该目录下的 `.claude/`、`CLAUDE.md`、`.mcp.json` 等信息都属于这个项目的工作区上下文
- CodeM 会读取这些工作区信息用于补充显示和运行配置
- CodeM 不反向写入 Claude Code 的工作区配置文件

### 6.2 项目层

左侧“项目”最终不是文件树，而是项目工作区入口。项目至少要包含：

- 项目显示名
- 项目真实路径
- 最近更新时间
- 是否展开
- 是否当前激活项目
- 是否检测到 Claude Code 项目配置
- 当前 git 分支

项目字段建议至少包含：

- `id`
- `path`
- `name`
- `updated_at`
- `created_at`

其中：

- `path` 是真实目录，是项目的核心标识
- `name` 是 CodeM 内部可重命名的显示名

### 6.3 项目 rename 规则

`Rename project` 只修改 CodeM 内部的 `project.name`，不修改磁盘目录名。

明确约束：

- 允许修改项目显示名
- 不修改 `project.path`
- 不重命名实际文件夹
- 不反写 `.claude/settings.json`
- 不反写 `.claude/settings.local.json`
- 不影响 git 仓库、worktree、编辑器工作区或 Claude Code 自己的目录语义

新增项目时：

- 默认项目名取目录名
- 用户后续可单独修改显示名

### 6.4 线程层

线程属于项目，不属于全局。

线程至少需要包含：

- 标题
- 项目归属
- provider
- model
- permission mode
- provider session
- working directory
- 消息历史
- 更新时间
- 是否置顶
- 是否归档
- 是否未读

线程字段建议至少包含：

- `id`
- `project_id`
- `title`
- `provider`
- `session_id`
- `working_directory`
- `model`
- `permission_mode`
- `pinned`
- `archived`
- `unread`
- `updated_at`

### 6.5 线程与 provider session 的关系

- `Thread` 是 CodeM 的产品线程
- `provider session` 是底层 Claude Code / Codex / Gemini 的真实会话标识
- 一个线程需要绑定自己的 `sessionId`
- 切换线程时，要恢复该线程自己的消息历史与 provider session

### 6.6 Claude Code 工作区信息的读取策略

CodeM 对 Claude Code 工作区采用“只读合并”策略。

应读取的信息：

- `~/.claude/settings.json`
- `<project>/.claude/settings.json`
- `<project>/.claude/settings.local.json`
- `<project>/CLAUDE.md`
- `<project>/.mcp.json`

这些信息用于：

- 补充项目的运行上下文
- 推断默认模型、权限偏好、MCP 可用性
- 为后续 provider 适配保留项目级配置入口
- 读取当前 git 分支并展示项目当前代码上下文

不做的事情：

- 不反写上述 Claude Code 配置文件
- 不把 Claude Code 工作区当成 CodeM 的主数据库
- 不依赖 Claude Code 本地缓存来替代 CodeM 自己的项目、线程索引

### 6.7 Claude Code session 导入与命名策略

CodeM 需要支持把 Claude Code 本地可恢复 session 作为初始化导入源之一。

导入原则：

- CodeM 启动时优先加载自己的 SQLite 数据
- 然后扫描 Claude Code 本地 session 缓存
- 按工作区目录将 Claude Code session 合并到对应 `Project`
- 已存在映射的线程更新元数据，不重复创建
- 不直接把 Claude Code 的本地 session 文件当成 CodeM 的唯一主数据源

P1 明确支持的能力：

- 导入 Claude Code session
- 显示 Claude Code session name
- 复制 session ID
- CodeM 内部重命名线程

P1 不做的事情：

- 不反写 Claude Code session 文件
- 不强依赖外部方式去修改旧 session 的 Claude Code 会话名称

命名规则：

- CodeM 线程有自己的 `title`
- Claude Code session 若存在名称，则作为导入时的初始标题来源之一
- 用户在 CodeM 内执行“重命名聊天”时，默认只修改 CodeM 自己的线程标题
- CodeM 内部 rename 不影响 Claude Code 的目录、配置或本地 session 存储

### 6.8 当前交互规则

- 点击“新建聊天”创建一个新的线程
- 旧线程保留在左侧
- 当前线程默认续聊
- 切换线程时恢复该线程自己的消息历史与 provider session

### 6.9 后续输入队列

当当前线程正在运行时，用户再次发送 prompt：

- 不立即打断当前运行
- prompt 进入该线程自己的后续需求队列
- 输入框上方展示排队内容
- 每条排队内容都可以删除
- 删除排队内容只影响尚未执行的 prompt，不影响正在运行的 Claude 进程
- 当前运行结束后，再按队列顺序继续执行

不同线程的队列互相隔离，切换线程时只展示当前线程的排队内容。

## 7. 左侧项目区规范

### 7.1 Project Panel Header

左侧“项目”区域的 Header 有 3 个按钮，P1 均需要实现。

三个按钮分别承担：

- 视图切换按钮
- 排序 / 显示设置按钮
- 新增项目按钮

P1 要求：

- 三个按钮都能点击
- 新增项目按钮需要真正创建项目
- 视图切换和排序 / 显示设置按钮在 P1 可以先实现基础状态切换与菜单展示

### 7.2 项目区排序 / 显示状态

项目区本身有独立的 UI 状态，不属于某个项目，也不属于某个线程。

建议状态模型：

- `organizeBy`
  - `project`
  - `timeline`
  - `chat-first`
- `sortBy`
  - `created`
  - `updated`
- `visibility`
  - `all`
  - `relevant`

P1 默认值：

- `organizeBy = project`
- `sortBy = updated`
- `visibility = all`

P1 可以先只让默认值生效，但菜单和状态模型要预留。

### 7.3 项目行能力

项目行右侧至少有两个动作：

- `...` 项目菜单
- 在该项目下新建线程的快捷按钮

P1 中项目菜单先实现：

- 在资源管理器中打开
- 修改项目名称
- 移除

P1 中项目运行信息先实现：

- 读取当前 git 分支
- 展示当前 git 分支

P1 对 git 的范围只限于只读展示：

- 读取当前分支
- 非 git 目录时优雅降级
- detached HEAD 时显示简化状态

P1 不做：

- 切换分支
- 创建分支
- merge / rebase / stash
- 其他写操作

P1 不做但要在文档里保留的后续项：

- 创建永久工作树
- 归档该项目下聊天

### 7.4 线程行能力

线程是项目下的一等公民，不只是消息集合。

P1 中线程菜单先实现：

- 重命名聊天
- 复制会话 ID

P1 之后可以继续补：

- 置顶聊天
- 归档聊天
- 标记为未读
- 在资源管理器中打开
- 复制工作目录
- 复制 Deeplink
- 派生到本地
- 派生到新工作树
- 在迷你窗口中打开

## 8. 持久化设计方向

### 8.1 为什么不用 localStorage

项目定位已经不是一次性 demo，而是准备长期自用并给同事使用，因此：

- 需要稳定持久化
- 需要可迁移
- 需要支持搜索、筛选、归档、导出
- 需要更适合多表关系的存储结构

因此持久化方案确定优先走 `SQLite`。

### 8.2 SQLite 设计原则

- 用户级本地数据库
- 支持 schema version / migration
- 数据库存储位置不放在项目目录内
- 启动时自动恢复项目、线程与上次上下文

### 8.3 第一版建议表

#### `projects`

- `id`
- `name`
- `path`
- `created_at`
- `updated_at`

#### `threads`

- `id`
- `project_id`
- `title`
- `provider`
- `session_id`
- `working_directory`
- `model`
- `permission_mode`
- `pinned`
- `archived`
- `unread`
- `updated_at`

#### `provider_sessions`

- `id`
- `thread_id`
- `provider`
- `session_id`
- `workspace`
- `metadata`

#### `messages`

- `id`
- `thread_id`
- `role`
- `content`
- `status`
- `metrics`
- `created_at`

#### `tool_calls`

- `id`
- `thread_id`
- `message_id`
- `tool_name`
- `input_text`
- `result_text`
- `status`
- `created_at`

#### `app_state`

- `key`
- `value`

#### `panel_state`

- `organize_by`
- `sort_by`
- `visibility`
- `active_project_id`
- `active_thread_id`

### 8.4 第一版不急着持久化的内容

- 正在运行中的瞬时状态
- `backendRunId`
- 调试抽屉是否展开
- 全量 `rawEvents`
- 全量 `debugEvents`

这些先放内存即可，等后面需要“问题回放”再扩展。

## 9. 当前 UI 与功能约束

### 9.1 风格约束

- 优先向 Codex Desktop 靠拢，而不是通用聊天产品
- 图标优先使用 SVG 图标体系
- 白色主界面 + 左侧浅色项目栏
- 工具步骤要轻量、嵌入、可折叠
- `TodoWrite` 使用计划卡片展示，列表显示任务总数与完成数量
- 当前未完成计划需要在输入框上方固定展示，方便用户不用滚动也能看到任务状态
- 对话流中的原始计划卡片保留，底部固定卡片只是一份当前任务摘要
- 固定任务卡片只展示最新一条 `TodoWrite`；最新计划全部完成后自动收起，不回退到旧计划
- Plan 确认、权限审批和 AI 提问要使用卡片/弹窗表达，不应该只显示红色工具错误

### 9.2 不做的事情

- 不伪造模型思考链
- 不把工具日志直接堆成终端面板主视图
- 不把单个 provider 的概念直接写死到 UI 和数据库
- 不把 `Rename project` 实现成重命名磁盘目录
- 不反写 Claude Code 工作区配置文件
- 不把已被转成审批卡片的权限拦截再重复展示成普通错误日志
- 不把 Claude Code 隐藏权限模式暴露成复杂菜单项

## 10. 当前已确认的细化需求

### 10.1 对话与任务卡片

- `TodoWrite` 工具结果渲染为白色计划卡片
- 卡片顶部展示“共 N 个任务，已经完成 M 个”
- 任务项按编号展示，完成项弱化，当前项保持高亮可读
- 底部固定任务卡片位于输入框上方
- 固定任务卡片不会改变对话流历史内容
- 最新任务全部完成后，固定卡片自动关闭

### 10.2 审批与 Plan

- `ExitPlanMode` 映射为“计划待确认”
- 批准计划后提示 Claude 退出 Plan 并开始执行
- 拒绝计划后提示 Claude 保持 Plan 并重新调整计划
- 普通权限审批批准后允许临时提升为完全访问
- 审批按钮点击后弹窗应立即进入处理状态并关闭，不等待整轮回复结束
- 后端在人工确认节点必须暂停当前 runtime，避免后续自动错误结果污染对话

### 10.3 权限与模型

- 权限菜单只展示三档：默认、自动执行、完全访问
- 权限图标使用稳定可识别图标：默认 Shield，自动 Zap，完全访问 Unlock
- 隐藏权限值只作为兼容数据保留，不在菜单直接展示
- 非运行线程切换时应刷新模型 / provider 配置
- 热会话运行中不强制切 provider；运行结束后同步最新配置

### 10.4 运行队列和统计

- 运行中发送的新 prompt 进入当前线程队列
- 队列项要有删除入口
- 删除队列项不影响当前运行
- 输出 token 在运行中允许使用估算值平滑展示
- 运行结束后以 Claude Code 返回的真实统计为准

## 11. P1 范围

本节保留项目层和线程层的 P1 范围，用于判断当前实现是否偏离原始目标。当前项目与线程主体能力已经落地，未完成项以后续补齐为主。

### 11.1 P1 必做

- 左侧主导航：
  - 新建聊天真实实现
  - 搜索轻实现
  - 插件占位
  - 自动化占位
- 项目区 Header 的 3 个按钮都实现
- 新增项目
- 默认按项目组织显示
- 项目列表真实化
- 项目行右侧快捷新建线程
- 初始化导入 Claude Code session
- 读取并展示项目当前 git 分支
- 项目菜单：
  - 在资源管理器中打开
  - 修改项目名称
  - 移除
- 线程列表真实化
- 显示 Claude Code session name
- 线程菜单：
  - 重命名聊天
  - 复制会话 ID
- 持久化：
  - 项目
  - 线程
  - 当前激活项目
  - 当前激活线程
  - 线程 `sessionId`
  - 线程 `workingDirectory`

### 11.2 P1 可先占位

- 搜索消息正文
- 插件真实功能闭环
- 自动化真实功能闭环
- 视图切换按钮的完整逻辑
- 排序 / 显示设置的完整逻辑
- 相关聊天过滤
- 将 CodeM rename 反向同步到 Claude Code session name
- 创建永久工作树
- 归档项目级聊天
- 线程置顶
- 线程归档
- 标记未读
- Deeplink
- 派生到本地 / 工作树
- 迷你窗口

## 12. 下一阶段开发顺序

### Phase 1：文档与模型对齐

- 沉淀当前需求
- 梳理 Claude Code 特性边界
- 定义多 provider 统一模型

### Phase 2：真实项目层

- 补齐项目层细节能力
- 强化线程与项目的恢复一致性
- 完善选择目录创建项目的边界提示
- 每个项目恢复最近线程的体验继续打磨

### Phase 3：SQLite 持久化

- 建库与 migration
- 项目、线程、消息、provider session 落库
- 启动恢复 active project / active thread

### Phase 4：Provider 抽象

- 把 Claude Code 封装为第一个 provider adapter
- 统一事件模型
- 为后续 Codex / Gemini 适配预留接口

### Phase 5：增强能力

- 项目搜索
- 线程搜索
- 线程归档 / 重命名
- 导出会话
- 更完整的工具结果与 diff 视图

## 13. 当前明确结论

- 不是继续堆临时 UI，而是朝长期可用工具演进
- 项目栏要做成真实项目 + 线程结构
- `Project` 与 Claude Code 的目录工作区一一对应
- `Rename project` 只改显示名，不改实际目录
- 对话默认续聊，但旧线程不能因为新建会话被清掉
- 持久化方案确定优先走 `SQLite`
- 数据模型必须从现在开始支持多 provider
- 在实现项目与持久化前，需要持续补齐对 `Claude Code` 特性的理解
