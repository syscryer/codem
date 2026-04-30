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
