# Git 工作台与冲突处理

## 背景

本轮调整把 Git 审查、提交、同步失败诊断和冲突处理从分散入口收束到右侧工作台与统一反馈体系中。目标不是做一个只覆盖单一路径的临时面板，而是让常见 Git 风险状态有明确位置、明确操作、明确日志，并且后续不需要频繁推翻这块交互。

## 已落地范围

- 右侧工作台的 `文件 / 已更改文件` 承接常驻审查、diff 预览、提交和提交后推送入口。
- 推送继续使用独立预览确认，提交并推送时先完成提交，再打开推送预览，由用户二次确认远端和目标分支。
- 新增 Git 冲突中心，展示分叉、脏工作区阻塞、冲突中、操作进行中等状态。
- 冲突中心支持读取冲突文件、展示 base/current/incoming/result、保存解决结果、标记已解决、继续操作和中止操作。
- 分叉状态提供 `合并拉取` 与 `变基拉取` 两条恢复路径，确认在面板内完成，不使用浏览器原生确认框。
- 右侧文件面板在没有冲突中心时保持单行满高；只有冲突中心显示时才切换为上方状态区加下方审查区，避免普通状态下缩成一团。
- Git 历史区增强右键菜单，覆盖分支签出、拉取、合并拉取、变基拉取、推送、创建分支、创建标签、比较、复制和删除等高频动作。
- Git 操作成功 toast 保持简短；失败 toast 展示摘要，并可展开 stdout、stderr、命令、目标、分支和时间等诊断信息。
- toast 详情展开后不再自动关闭，避免用户查看日志时提示消失。
- 打开文件夹等外部打开动作成功时不再弹成功提示，只在失败时提示。
- 基础设置新增 `任务系统通知` 和 `排队消息立即发送`，前者只控制窗口失焦时的系统通知，后者控制运行中再次发送时是否尝试立即引导当前运行。

## 状态模型

后端通过 `GitOperationState` 暴露当前仓库的 Git 操作状态：

| 状态 | 含义 | 前端展示 |
| --- | --- | --- |
| `clean` | 无需处理的干净状态 | 不显示冲突中心 |
| `dirty` | 普通本地变更 | 审查区展示变更和提交入口 |
| `blocked_dirty` | 远端有更新但本地存在未提交变更 | 冲突中心提示先提交、暂存或撤销 |
| `diverged` | 当前分支与上游分叉 | 冲突中心提供合并拉取和变基拉取 |
| `conflicted` | 存在冲突文件 | 冲突中心展示冲突列表和解决编辑区 |
| `in_progress` | merge、rebase、cherry-pick 或 revert 正在进行 | 冲突中心提供继续和中止 |

冲突文件通过 `GitConflictFileDetail` 暴露四块内容：

- `baseContent`：共同基线内容。
- `currentContent`：当前分支内容。
- `incomingContent`：传入分支或远端内容。
- `resultContent`：工作区当前结果，用户保存和标记解决都基于这一份内容。

## 交互约定

- 提交入口归一到右侧工作台，不再在顶部或散落弹窗里增加新的提交入口。
- 推送属于高风险远端写操作，必须保留预览和确认，不应从提交按钮直接静默推送。
- 分叉恢复必须让用户明确选择合并拉取或变基拉取，不能自动替用户决定。
- 冲突中心的危险操作使用面板内确认条，避免浏览器原生弹窗打断上下文。
- `blocked_dirty` 不做自动 stash 或自动覆盖，必须提示用户先处理本地变更。
- 成功类提示只展示用户需要知道的结果；失败类提示必须保留详细日志入口，方便排查真实 Git 输出。
- 已展开详情的 toast 不自动关闭，用户手动收起或关闭后再恢复普通生命周期。
- 外部打开、打开文件夹等低风险成功动作默认静默，失败时再给出 toast。
- 任务系统通知只受设置项控制右下角系统通知，不影响会话列表完成标记、任务栏状态或应用内状态展示。

## 后端接口

本轮 Git 冲突处理使用以下接口：

- `GET /api/projects/:projectId/git/operation-state`
- `GET /api/projects/:projectId/git/conflicts/file?path=...`
- `POST /api/projects/:projectId/git/conflicts/save-result`
- `POST /api/projects/:projectId/git/conflicts/mark-resolved`
- `POST /api/projects/:projectId/git/operation/continue`
- `POST /api/projects/:projectId/git/operation/abort`
- `POST /api/projects/:projectId/git/pull`

实现要求：

- 所有路径必须走项目根目录校验，不能允许跨项目读取或写入。
- 继续和中止操作必须基于当前 `operation` 选择合法 Git 命令。
- 分叉与脏工作区阻塞要由真实 Git 状态推导，不能靠前端猜测。
- Git 命令失败时要保留 stderr/stdout，以便前端详情展开查看。

## 验证记录

自动验证覆盖：

- `server/lib/workspace-store-git.test.ts`
- `src/lib/git-api.test.ts`
- `src/lib/git-conflict-center.test.ts`
- `src/lib/git-operation-toast-detail.test.ts`
- `src/lib/git-workbench-entry.test.ts`
- `src/lib/git-history-context-menu.test.ts`
- `src/lib/git-history-context-menu-dismiss.test.ts`
- `src/lib/workbench-layout.test.ts`

本地手工验证仓库：

- `D:\data\git-test`

手工测试重点：

- 普通提交后可以打开推送预览，并需要用户确认后才推送。
- 当前分支 ahead/behind 分叉时，冲突中心能展示合并拉取和变基拉取。
- 合并或变基进入冲突后，冲突文件能读取、保存、标记解决并继续。
- 中止操作需要面板内确认条确认。
- 普通审查区没有冲突中心时不被压缩，高度应完整可用。
- Git 失败 toast 可展开详情，展开后不会自动消失。

## 后续边界

- 暂不做自动冲突解决、自动 stash 或自动选择 merge/rebase。
- 暂不把 Git 冲突编辑区升级为完整代码编辑器；当前只保证文本内容可编辑保存。
- 暂不把所有 Git 历史危险操作都改为自定义确认弹层；如果后续统一确认体验，应与现有 GitDialog 和冲突中心确认条保持一致。
- 后续若接入三方 merge editor，应继续复用当前状态模型和后端接口，不另起一套冲突数据结构。
