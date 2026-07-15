# Claude Code UI 包装器

## 目标
- 在 `D:\cursor_project\codem` 创建一个最小可用的本地 UI。
- 通过界面调用本机 `claude` CLI。
- 支持流式输出、会话续接、任务取消、工作目录切换。

## 阶段
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 调研 Claude CLI 输出协议 | completed | 已确认 `--print --verbose --output-format stream-json` 可用 |
| 2. 设计前后端最小架构 | completed | 采用 React + Vite + Express 本地桥接 |
| 3. 搭建项目骨架 | completed | 已创建前端、后端、脚本、样式与 README |
| 4. 实现 Claude 调用链路 | completed | 已支持发送 prompt、解析流式 JSON、取消运行、续接 session |
| 5. 文档与校验 | completed | 已完成 `npm install`、`npm run typecheck`、`/api/health` 校验 |

## 当前决策
- 不直接做 Electron 或 Tauri，先做本地 Web UI，后续可再包桌面壳。
- 默认使用用户本机 `claude` 命令，不绑定 Claude subagent wrapper。
- UI 默认工作目录为 `D:\cursor_project\codem`，但允许改为其他本地目录。

## 当前重构计划：Rust 后端真实接口对照

## 目标
- 在 `D:\ai_proj\codem` 中彻底用 Rust 后端接管原 Node Express 后端。
- 原版 `D:\cursor_project\codem` 作为行为基线，逐接口用真实请求对照。
- 不保留 Node 后端运行兜底；发现差异时修 Rust 实现或明确记录可接受差异。

## 阶段
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 恢复上下文与任务记录 | completed | 已读取 README、Trellis workflow/spec、rust-backend-rewrite 任务和当前 session |
| 2. 修复接口对照脚本 | completed | 已修正 `projectId/threadId`、Git 写接口隔离、usage 种子、workspace 目标裁剪和数组代表元素比较 |
| 3. 重跑真实接口对照 | completed | 已对照 workspace/project/thread/Git/Claude/MCP/plugins/skills/settings/file/attachments 等 50 个真实接口 |
| 4. 修复真实差异 | completed | 已补 Claude trace/claude-event、Git graph segment、MCP 空 args、workspace null 字段、线程可见性过滤等差异 |
| 5. 验证与记录 | completed | 接口对照 50/50 通过；cargo check、typecheck 通过；Trellis 和进度文件已记录 |

## 当前发现
- 路由数量 96/96 已覆盖，但不能等同于行为完成。
- 最终接口对照结果：50 个接口全部通过，结果文件在 `%TEMP%\codem-api-compare-fixtures\api-compare-results.json`，日志在 `%TEMP%\codem-api-compare-last-run.log`。
- 对照脚本会将 live workspace/usage 中与本轮目标无关的真实历史数据归一化，避免旧库历史脏数据影响接口契约判断。

## 风险
- Claude CLI 的参数将来可能变化，后端需尽量做兼容解析。
- Windows 下命令解析与字符流分片需要特别处理。

## 后续增强
- 增加多会话历史列表和本地持久化。
- 增加模型、额外参数、allowedTools 等高级设置。
- 如果要做成桌面端，可在当前基础上再包 Electron 或 Tauri。

## 当前解析补齐计划：AI 返回信息覆盖
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 对照 Any-code 解析范围 | completed | 已确认不迁移注册体系，只补 CodeM 现有 ToolStep 模型缺口 |
| 2. 工具类型覆盖 | completed | 已补 Plan、TodoRead、UpdatePlan、LS/Grep/Glob、Web、BashOutput、KillShell、TaskOutput、Task 系列、MultiEdit、ViewImage 等标题和预览 |
| 3. 子代理消息 | completed | 已支持 `parent_tool_use_id` / `isSidechain`，子代理文本和工具挂到父 Agent/Task 详情 |
| 4. 工具结果细节 | completed | 已增强 tool result 按 `toolUseId` 合并，历史 orphan result 优先按 id 回挂 |
| 5. 历史持久化 | completed | 已为工具记录补充子工具和子消息 JSON 字段，兼容实时和 transcript 恢复 |
| 6. 校验 | completed | 已通过 typecheck、重启 dev 服务，并完成浏览器 smoke test |

## 当前重构计划：Codex Desktop 类对话流
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 需求对齐 | completed | 已读取 OpenSpec 中 conversation/tool card/stream activity 相关规范 |
| 2. 数据模型调整 | completed | 已从大 timeline 改为 turn 聚合模型 |
| 3. 工具调用展示 | completed | 工具调用以 inline step 展示，默认折叠参数与结果 |
| 4. 调试信息隔离 | completed | system/raw/snapshot 进入调试抽屉，不进入主对话 |
| 5. 校验与记录 | completed | 已运行 typecheck 并记录结果 |

## UI Contract
- 主对话只展示用户消息、Claude 正文、工具步骤摘要、完成状态。
- 工具步骤按 `toolUseId` 或 block index 聚合，不按每个 event 渲染。
- 工具结果默认折叠，只显示摘要，点击后查看参数、stdout/stderr/完整内容。
- `system/init/hook/status/raw/snapshot` 默认进入调试抽屉。
- 用户消息保留换行、缩进、列表和代码块格式。
- 默认白色主题，避免大框日志感。

## 当前规划：右侧工作台（可收缩工具面板）

## 目标
- 将顶栏最右侧分栏按钮定义为“右侧工作台”总开关。
- 右侧工作台不是 Git 专用面板，而是可承载多个工具页的容器。
- 第一版优先支持 `概览`、`文件`、`浏览器` 三个页签，其中 `文件` 支持 `所有文件 / 已更改文件` 切换。
- 第一版同时支持“写入文件预览”：AI 写入/修改文件卡片可在工作台中打开只读文件 tab。
- 顶栏文件夹按钮作为文件视图入口：点击后打开工作台并切到 `文件 / 所有文件`。
- `+60 -6` Git diff chip 作为 Git 审查入口：点击后打开工作台并切到 `文件 / 已更改文件`。

## 范围边界
- 第一版只做右侧工作台布局、页签状态、Git 审查预览和浏览器空壳。
- 第一版不做真实文本编辑保存，不做完整内嵌浏览器加载，不做拖拽改变宽度。
- 文件预览第一版只读；Markdown 渲染预览，普通文本代码预览，二进制/过大文件显示不可预览。
- 文件夹按钮继续沿用当前“打开/选择项目打开工具”的单按钮行为。
- 提交弹窗仍保留；右侧工作台用于常驻审查，提交弹窗用于最终提交/推送动作。

## 阶段
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 产品语义收敛 | completed | 已确认右侧工作台是多工具容器，最右分栏按钮控制整体收缩，文件夹按钮是单按钮 |
| 2. 状态模型设计 | completed | 已新增 `rightWorkbenchOpen`、`rightWorkbenchTab`、`rightWorkbenchFileScope`，tab 初始包含 `overview`、`files`、`browser` |
| 3. 布局骨架实现 | completed | 已在 `chat-shell` 外增加可收缩右侧区域；关闭时聊天区吃满，打开时右侧固定宽度 |
| 4. 文件页实现 | completed | 文件页支持所有文件懒加载树，也可切换到已更改文件虚拟树和 diff 预览 |
| 5. 文件预览 tab | in_progress | 所有文件点击可打开到工作台；Markdown 渲染预览和普通文本只读预览已接入；写入/修改文件卡片入口待接入 |
| 6. 浏览器页占位 | pending | 浏览器页先实现 URL 输入栏和空白页，不接真实浏览器能力 |
| 7. 顶栏入口联动 | in_progress | 最右分栏按钮、文件夹按钮和 `+60 -6` 已接入；文件卡片打开预览待接入 |
| 8. 样式与响应式 | pending | 桌面宽屏固定右侧工作台；窄屏后续再做抽屉覆盖，第一版保证不挤坏输入框 |
| 9. 验证 | pending | 运行 `npm run typecheck`，必要时重启 Web dev 服务；不构建桌面版，除非后续明确改桌面专属壳 |

## 交互草图

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 顶栏                                                                  │
│  ▶ [打开方式] [提交 ▾] | [终端] [文件夹] [+60 -6] [工作台开关]          │
├──────────────────────────────┬───────────────────────────────────────┤
│                              │ 右侧工作台                              │
│ 聊天区                        │ ┌───────────────────────────────────┐ │
│                              │ │ 概览 | 审查 | 浏览器 | +      ↗    │ │
│ 消息流                        │ ├───────────────────────────────────┤ │
│                              │ │ 当前 tab 内容                       │ │
│ 输入框                        │ │ 审查：diff + 文件树                 │ │
│                              │ │ 浏览器：URL 输入 + 空白页            │ │
│                              │ │ 概览：任务、运行状态、Git 摘要       │ │
│                              │ └───────────────────────────────────┘ │
└──────────────────────────────┴───────────────────────────────────────┘
```

## 当前决策
- 工作台开关按钮只控制 `rightWorkbenchOpen`，不直接代表 Git。
- 文件夹按钮点击行为调整为“打开工作台并进入所有文件”，可以查看项目根目录并懒加载展开文件夹。
- Git diff chip 的点击行为从“只刷新 diff”调整为“打开工作台并进入已更改文件”；刷新可以保留在文件页内部。
- 已更改文件第一版复用已有 `/api/projects/:id/git/status` 和 `/api/projects/:id/git/diff`，所有文件新增轻量 `/api/projects/:id/files?path=...` 目录接口。
- 文件工作台采用“左侧预览 tab + 右侧文件树”结构；所有文件点击打开代码或 Markdown 预览，已更改文件点击打开 diff tab。
- 浏览器页第一版是 UI 壳，后续再决定接 in-app browser、Tauri WebView 或外部浏览器。
- 文件预览复用已有 `/api/system/file-preview`，不新增文件读取后端；只允许预览项目内文件。
- 详细实现 checklist 已沉淀到 `.trellis/tasks/right-workbench.md`，后续开工前优先读取该文件。

## 风险
- 当前 `App.tsx` 已承载较多状态，新增工作台状态时需要避免继续膨胀；若改动变大，应拆出 `RightWorkbench` 组件。
- Git 审查和提交弹窗都读取 Git status/diff，需要避免重复请求导致 UI 抖动；第一版可以接受局部请求，后续再抽共享 hook。
- 右侧工作台会挤压聊天区，必须确保 composer 和消息滚动不出现横向滚动。

## 当前规划：独立普通 AI 聊天完整链路

### 目标

- 在不依赖 Agent、项目和 CLI session 的前提下提供完整普通 AI 聊天。
- 保持 CodeM 原有聊天窗口风格，供应商和模型继续放在 Composer 底部选择。
- 支持多供应商、每供应商多模型、会话内单模型切换、MCP、Skills、知识库、附件和历史恢复。
- 使用独立 worktree/分支，避开另一个会话正在修改的设置界面。

### 视觉论点

普通聊天应像 CodeM 原生能力自然生长出来：克制、紧凑、以消息和输入为主，不复制 Cherry Studio 页面结构，不增加无意义卡片和装饰。

### 内容结构

- 左侧：新建任务、新建聊天、普通聊天列表、项目 Agent 任务。
- 中间：复用现有消息流、Markdown、工具步骤、引用和滚动。
- 底部：附件/知识库/MCP/Skills 在左，普通聊天供应商/模型/发送在右。
- 右侧：继续复用现有工作台，不新增普通聊天专属侧栏。

### 交互论点

- 新建任务与新建聊天切换使用现有页面过渡，不引入重型动效。
- 供应商/模型菜单复用 CodeM popover 的快速淡入和键盘导航。
- 模型切换用轻量分隔提示记录上下文变化，工具和引用沿用现有渐进展开。

### 阶段

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 隔离与任务建立 | completed | 已创建 `codex/ordinary-chat` worktree/分支和独立 Trellis session |
| 2. 现状盘点与契约冻结 | completed | 已冻结独立 router/service、`ai_*` 表、通用事件、Composer 布局和工具/知识库边界 |
| 3. 数据模型与迁移 | completed | 已建立 `ai_*` 表、供应商/模型/聊天 CRUD、消息与运行记录、模型快照和历史读取 |
| 4. 供应商与协议适配 | completed | 已完成精选模板、加密密钥 vault、模型探测、图片多模态、四类流式 adapter 和工具调用归一化 |
| 5. 聊天运行时 | completed | 已完成 NDJSON streaming、停止、重连、模型切换、上下文裁剪、自动标题、历史恢复和多聊天并发隔离 |
| 6. MCP 与 Skills | completed | 已完成 Skills 安全注入、MCP stdio/Streamable HTTP、工具循环、持久化、事件恢复和危险操作审批 |
| 7. 知识库 | completed | 已完成本地 CRUD、文件/目录/文本导入、切片、向量检索、重建、删除、聊天多选、来源引用和管理弹窗 |
| 8. 前端普通聊天 | completed | 已完成独立列表、Composer、MCP/Skills/知识库、usage、消息编辑/删除/重试/重新生成、导出和空态 |
| 9. 设置接线与兼容整合 | completed | 已提供独立可复用 Provider 管理组件并从普通聊天直接打开；设置页薄嵌入留给并行设置会话合并，不阻塞聊天完整使用 |
| 10. 验证与收口 | completed | Rust/TS/生产构建/前端回归/安全扫描/真实 UI 窄窗烟测均通过，隔离服务已重启到最新版本 |
| 11. 最终加固审计 | completed | 修复 Anthropic `/v1` 地址重复、运行前置校验脏历史、重连失败卡死和运行记录内存保留问题，并补充回归测试 |
| 12. 数据一致性加固 | completed | 知识库查询显式传播行错误，配置更新与重建实现事务回滚；模型创建/发现/禁用/删除和旧库修复保持单一启用默认模型，28 个定向测试与全量门禁通过 |
| 13. 合并主线 | completed | 普通聊天 `339a3a2` 与设置 `06fdd91` 分别提交，合并提交 `eece0a1` 已进入 `main`；冲突保留双方实现，Rust/前端全量验证和主桌面健康检查通过 |
| 14. 供应商全局设置与发送体验 | completed | 已接入全局 AI 供应商设置、精选模板分组、无配置引导和 Enter 发送；TypeScript、构建、前端 30 项定向测试、Rust 28 项普通聊天测试与 Git 差异门禁通过 |

### 不做事项

- 不做一次提问多个模型同时回答。
- 不把普通聊天塞进项目 Agent `threads` 语义。
- 不引入大量中转商和推广供应商。
- 不在另一个设置会话进行中修改同一设置页面文件。

### 风险

- 当前 Agent `ThreadSummary` 深度绑定 project/provider session，普通聊天必须避免继续堆可空字段导致语义混乱。
- MCP 工具调用在“非 Agent”模式下仍需要完整循环和审批，不能只做 prompt 注入。
- 知识库是完整子系统，需要控制依赖体积、索引性能、嵌入隐私和删除一致性。
- 不同 API 的工具调用与流式结构差异大，必须先统一内部事件再接 UI。
- 设置界面并行开发可能产生接线冲突，因此核心能力先落独立模块，最后只做薄接线。

### 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
| --- | --- | --- |
| `apply_patch` 因 `cargo fmt` 重排导入后上下文不匹配 | 1 | 读取精确片段并拆成按文件小补丁，不重复大型补丁 |
| `ProviderStreamEvent` 从私有导入路径引用导致 E0603 | 1 | 共享事件统一从 `types` 导入 |
| 恢复记录的大型补丁因 findings 标题不一致而匹配失败 | 1 | 先定位精确标题与文件尾部，再拆分为小补丁 |
| 隔离 worktree 未安装 `node_modules`，typecheck 找不到 `tsc` | 1 | 使用 `npm ci` 按 lockfile 安装隔离依赖后再验证 |
| 新增多模态 builder 后 `cargo fmt --check` 报排版差异 | 1 | 运行 `cargo fmt` 后重新执行格式门禁 |
| PowerShell 中双引号正则的 `|` 被误解析 | 1 | ripgrep 正则统一使用单引号 |
| MCP 首轮编译：审批错误类型和 Claude project config 参数类型不匹配 | 1 | 将审批错误显式映射为 message，保留 `.claude.json` 的 `Option<Value>` 传入既有解析函数 |
| 普通聊天 usage union 无法直接读取 nested usage | 1 | 用 `usage in event` 区分普通聊天 nested usage 和标准 flat usage，再统一映射 |
| 消息编辑按钮漏导入 `Pencil` | 1 | 补充现有 lucide-react 图标 import 后 typecheck 通过 |
| Header 导出回调返回 boolean 不符合 void 契约 | 1 | Workspace 用无返回值包装调用，保留 hook 内导出成功布尔值 |
| Windows `rg` 直接使用 `vite.config.*` 路径通配符报文件名语法错误 | 1 | 改用 `rg --files -g 'vite.config.*'` 获取真实文件名 |
| Provider manager 被后置 `.dialog-card` 宽度覆盖为 420px | 1 | 使用更明确的 `.dialog-card.ai-provider-manager-dialog`，并复测默认/窄窗无溢出 |
| 删除最后一轮后普通聊天显示 Agent 空态文案 | 1 | `ConversationPane` 对 ordinary 传入的 empty copy 同时覆盖已有空聊天 |
| 浏览器读取旧 textbox locator 和等待旧空态各超时一次 | 1 | 立即刷新 DOM snapshot，确认前者是 locator 过期、后者暴露真实空态文案问题 |
| 样式语义审计脚本缺少 `postcss-selector-parser` | 1 | 不新增依赖，改用本地括号感知的选择器拆分逻辑完成审计 |
| 进程树检查命令出现 PowerShell 空管道解析错误 | 1 | 将 `foreach` 结果先收集到数组再统一格式化输出 |
| `styles.css` 出现 6000 余行选择器重组噪音 | 1 | 对比选择器声明确认无既有语义变化，机械收敛为原基线加 928 行普通聊天专属样式 |
| 最终记录大补丁因 findings 目标行不存在而未应用 | 1 | 改为逐文件小补丁，先读取精确尾部再写入 |
| 全量 Clippy `-D warnings` 被仓库既有 Agent/backend 告警阻断 | 1 | 记录既有告警类别，并用排除既有类别的 Clippy 门禁验证普通聊天新增代码无额外告警 |
| 加固改动后 `cargo fmt --check` 发现三处排版差异 | 1 | 运行 `cargo fmt` 后重新执行格式、测试和构建门禁 |
| 旧 dev exec session 已失效，无法通过 stdin 停止 | 1 | 核对 3101/5174 进程祖先与路径，只停止隔离 worktree 的孤儿进程树后重新启动 |

## 当前规划：OpenCode Agent Provider 完整接入

### 目标

- 将 OpenCode 作为与 Claude Code、OpenAI Codex、Grok Build 并列的独立 Agent Provider。
- 基于 OpenCode 实际公开协议实现检测、诊断、模型目录、新建/恢复会话、流式事件、取消和设置管理。
- 保持普通聊天链路完全独立，不把 OpenCode Agent 复用为普通聊天供应商配置。

### 阶段

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 0. 提交现有成果 | completed | `a0220aa` 已推送 Gitee `origin/main` 与 GitHub `github/main` |
| 1. OpenCode 能力调研 | completed | 本机 1.17.7、ACP 能力、MiniMax 模型切换/流式 prompt/session close 已真实验证 |
| 2. 接入契约与任务验收 | completed | Provider id、共享 ACP profile、模型/权限/MCP/Skills 边界和验收标准已写入 Trellis |
| 3. 后端 Registry 与诊断 | completed | 命令解析、ACP probe、配置/模型/规则诊断、MCP/Skills 与插件安全边界已完成并通过编译 |
| 4. Agent 运行与模型目录 | completed | 共享 ACP 已接入新建/恢复/热复用、模型 config option、权限、流式事件、取消和 usage |
| 5. 前端设置与入口 | completed | 图标、列表、默认 Agent、诊断/能力/模型、Composer、MCP/Skills/Usage 已完成 |
| 6. 自动化与真实验证 | completed | Rust 106/106、前端 458/458、TS/构建、真实 MiniMax、1280/760 浏览器验收全部通过 |
| 7. 记录、提交与双推送 | completed | Trellis/敏感扫描已完成，按项目规范提交并推送 Gitee/GitHub |

### 当前边界

- 优先复用 OpenCode 官方协议，不通过终端文本抓取模拟流式状态。
- 不修改普通聊天供应商、知识库、MCP/Skills 的独立运行机制。
- 若本机未安装或未认证，设置页必须明确展示真实状态，不能伪装可用。
- 不引入持久缓存掩盖 CLI 状态变化。

### 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
| --- | --- | --- |
| 误发空 `apply_patch` | 1 | 工具拒绝且无文件变化；后续只发送包含实际上下文和变更的补丁 |
| Node 24 直接启动 `opencode.cmd` 返回 `spawn EINVAL` | 1 | 改为解析包装脚本背后的真实 Node/二进制入口，不再直接 spawn `.cmd` |
| 错误记录状态补丁命中重复字段 | 1 | 使用错误条目标题作为同一 hunk 的唯一上下文并恢复旧状态 |
| Rust 测试夹具仍使用旧 Provider helper 签名 | 1 | 同步 OpenCode resolver/availability 参数并补新分支断言 |
| 自动审批改动影响既有 ACP 取消事件顺序 | 1 | 仅自动策略隐藏审批卡，Interactive 取消保留原事件序列 |
| OpenCode Skills 跨三个函数的大补丁上下文失配 | 1 | 确认无部分写入，改为按列出、安装、路径校验三个精确小补丁 |
| 插件 guard helper 补丁猜测了未读取的函数尾部 | 1 | 确认无部分写入，先读取完整函数，再拆成替换与插入两段补丁 |
| 前端核心三文件补丁在 Probe 类型上下文失配 | 1 | 确认无部分写入，按常量、联合类型、Probe 类型、设置归一化拆分补丁 |
| OpenCode 插件分支重复类型收窄、测试夹具变为 readonly | 1 | 删除外层已保证的重复判断，Probe 夹具显式使用可变结果类型 |
| 假定存在 `npm test` 脚本 | 1 | 命令未执行测试；改为读取 package scripts 后使用项目实际全量测试入口 |
| 服务进程链检查再次把 `foreach` 直接接管道 | 2 | 解析阶段失败、未触碰进程；已固定先赋值 `$rows` 再格式化，不再直接接管道 |
| PowerShell 循环变量 `$pid` 撞上只读 `$PID` | 1 | 赋值阶段失败、未触碰进程；统一改用 `$processId` |
| 真实联调猜测了不存在的 `/api/workspace` | 1 | 第一步 404、未创建测试数据；从实际 Router 确认 bootstrap 路由后重跑 |
| 普通 `rg` 模式使用字面 `\n` | 1 | 搜索子命令失败、后续读取正常；改用单行 `#[cfg(test)]` 标记 |
| unified exec 后端不支持 Ctrl+C | 1 | 请求被拒绝、服务仍运行；改用端口/路径/父命令核对后的 PID 停止 |
| 停止 backend/cargo 后上层 launcher 重新拉起新 PID | 1 | 未停止新 PID；先核对完整父链，再停止已验证的 dev:server 树 |
| 错误状态补丁连续两次使用了错误/重复上下文 | 2 | 均整体拒绝；将新增记录、状态更新和计划更新拆成独立小补丁 |
| Playwright 打开时 5173 已无监听 | 1 | 浏览器请求被拒绝、无页面状态；启动本仓库 dev:web 后复用会话 |
| 恢复阶段记录补丁引用了只存在于 findings 的取消结论 | 1 | 补丁整体拒绝且无部分写入；改为按文件真实尾部拆分精确补丁 |
| Windows `rg` 对 `.trellis/workspace/sessions/*.md` 路径通配符报错 | 1 | 其他目标仍正常读取；后续目录枚举统一使用 `-g '*.md'` |
| 内置 Browser runtime 初始化两次报 `Cannot redefine property: process` | 2 | 未进入页面、未改应用状态；按 Browser 技能降级为真实 Chromium Playwright CLI 验收 |
| WSL Playwright 路径与 Chrome 运行时不可用 | 2 | 先修正 `/mnt` 路径，再确认 WSL 缺少 Chrome；不安装额外浏览器，改用 Windows 原生 `npx.cmd` 复用本机 Chrome |

## 当前规划：清理遗留 Node 后端

### 目标

- 从当前 `main` 删除已退出开发、运行和发布链路的 `server/**` Node Express 后端。
- 保留 Rust/Tauri 当前功能、前端契约与用户数据不变。
- 迁移仍有效的测试引用，并让开发文档只描述当前 Rust 架构。

### 阶段

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 范围与引用盘点 | completed | Node 目录、活动引用、Rust 对等路由和历史文档边界已核对 |
| 2. 测试与脚本迁移 | completed | Rust 行为测试已补齐，Node 源码断言和失活 spike 已移除 |
| 3. 删除 Node 后端 | completed | `server/**` 与 Node 专属测试已删除，不保留运行兜底 |
| 4. 规范与文档收口 | completed | README、AGENTS、CLAUDE、Trellis backend 规范已统一为 Rust 架构 |
| 5. 全量验证与运行检查 | completed | Rust/前端/类型/构建/diff/桌面健康检查全部通过，Trellis 已记录 |

### 边界

- 不修改 Rust API、SQLite schema、Agent 事件或普通聊天机制。
- 不删除 `docs/superpowers/**` 等历史设计材料，只修正当前入口文档。
- 保留当前未提交的失焦完成提示改动和用户 `CONTEXT.md`。

### 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
| --- | --- | --- |
| 多文件规划补丁依赖 `findings.md` 漂移尾部而失败 | 1 | 补丁整体未写入；改为先读取各文件精确尾行，再按文件拆分补丁 |
| 单次 `cargo test` 传入两个测试过滤参数 | 1 | Cargo 只接受一个过滤字符串；按 `workspace_` 和完整 slash command 测试名分别运行 |
| 全量前端测试发现 Git diff badge 两条既有断言漂移 | 1 | `20e13da` 已移除 secondary 字段和对应 UI；删除遗漏的旧断言，不恢复废弃字段 |
