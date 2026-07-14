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
| 13. 合并主线 | in_progress | 普通聊天与多 Agent 设置分别提交后合并到 `main`，解决 5 个重叠文件并完成合并后验证 |

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
