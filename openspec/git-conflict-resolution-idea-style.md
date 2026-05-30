# Git 冲突解决 IDEA 式流程

## 状态

- 状态：已确认方向，待实现
- 日期：2026-05-29
- 背景提案：`openspec/git-workbench-conflict-resolution.md`
- 用户结论：现有右侧冲突中心能跑通，但太难用；目标改成接近 IDEA 的冲突总览弹窗 + 大尺寸合并编辑器。

## 问题

当前 Git 冲突中心把分叉恢复、冲突文件列表、三方内容、结果编辑、标记解决和继续操作都塞在右侧工作台里。右侧栏适合审查文件和轻量状态，不适合承载 merge editor。实际手测中，用户需要先理解 `blocked_dirty`、`conflicted`、`continue` 等 Git 状态，再在窄栏里滚动查看 base/current/incoming/result，认知负担过高。

IDEA 的交互更符合用户预期：先给“冲突文件列表 + 文件级快捷操作”，需要手工合并时再进入专门的大尺寸合并视图。CodeM 应该采用类似的两层流程，而不是继续扩展右侧内嵌编辑器。

## 目标

- 冲突解决入口清楚：右侧工作台只展示状态和“解决冲突”主入口。
- 冲突总览接近 IDEA：弹窗中列出冲突文件，并提供“接受当前”“接受传入”“合并...”。
- 手工合并使用大尺寸 modal：展示 base、当前 ours、传入 theirs、结果 result，不再挤在右侧审查栏。
- 所有冲突解决后，继续操作成为清晰主路径。
- 保留现有后端 Git 状态模型和安全边界，优先改前端交互，不新增自动 stash、自动覆盖或自动选择 merge/rebase。

## 非目标

- 第一版不做逐 hunk 的内联 merge editor。
- 第一版不接 Monaco、CodeMirror 或完整 IDE 编辑能力。
- 第一版不自动解决冲突、不自动提交、不自动推送。
- 第一版不改变 Git 操作后端命令语义，只复用现有 operation-state、conflict file、save、mark-resolved、continue、abort、pull 接口。

## 目标流程

### 分叉状态

当 `GitOperationState.status === 'diverged'` 时，右侧工作台顶部显示状态条：

- 标题：`当前分支与远端分叉`
- 摘要：展示 `ahead`、`behind`、远端和分支。
- 操作：`合并拉取`、`变基拉取`、`刷新`
- 点击合并或变基后，使用面板内确认条确认，不使用 `window.confirm`。

如果拉取进入冲突，自动打开冲突总览弹窗。

### 脏工作区阻塞

当 `GitOperationState.status === 'blocked_dirty'` 时，右侧工作台顶部显示阻塞状态：

- 标题：`远端有更新，但工作区存在未提交变更`
- 摘要：提示先提交、暂存、忽略或撤销本地变更。
- 下方审查区继续展示未跟踪/已修改文件。
- 不提供合并拉取主按钮，避免绕过真实 Git 风险。

### 冲突状态

当 `GitOperationState.status === 'conflicted'` 或 `hasConflicts === true` 时：

- 右侧工作台顶部显示 `当前有 N 个冲突文件`
- 主按钮：`解决冲突`
- 次按钮：`继续操作`、`中止操作`、`刷新`
- 如果还有未解决冲突，`继续操作` disabled，并提示“解决并标记后才能继续”。
- 点击 `解决冲突` 打开冲突总览弹窗。

## 冲突总览弹窗

总览弹窗是冲突处理的第一主界面，布局接近 IDEA：

- 标题：`将 {remote}/{branch} 合并到 {currentBranch}`，变基时显示 `将 {currentBranch} 变基到 {remote}/{branch}`。
- 表格列：`名称`、`您的更改`、`他们的更改`、`状态`。
- 文件行展示路径、状态标签和是否已解决。
- 右侧文件级操作：
  - `接受当前`
  - `接受传入`
  - `合并...`
- 底部操作：
  - `关闭`
  - `中止操作`
  - `继续操作`

文件级快捷操作规则：

- `接受当前`：把 result 写为 currentContent，保存并标记解决。
- `接受传入`：把 result 写为 incomingContent，保存并标记解决。
- `合并...`：打开大尺寸合并编辑器。
- 后续可以增加 `接受双方`，第一版优先在合并编辑器里提供，避免总览按钮过多。

## 大尺寸合并编辑器

合并编辑器使用 modal，宽度尽量接近主窗口可用宽度，不受右侧工作台宽度限制。

第一版布局：

- 顶部：文件名、冲突状态、上一个/下一个冲突文件。
- 上半区三列：
  - Base
  - 当前 ours
  - 传入 theirs
- 下半区 Result 编辑区。
- 底部操作：
  - `接受当前`
  - `接受传入`
  - `接受双方`
  - `保存结果`
  - `保存并标记解决`

行为约定：

- 进入编辑器时，result 使用后端返回的 `resultContent`。
- `接受当前`、`接受传入`、`接受双方`只更新 result，不立即标记解决，用户仍可检查。
- `保存结果`只调用 `saveGitConflictResult`。
- `保存并标记解决`先保存 result，再调用 `markGitConflictResolved`。
- 标记解决后回到总览弹窗，并刷新 operation-state。
- 如果所有冲突都已解决，总览底部 `继续操作` 变成主按钮。

## 组件边界

建议新增组件目录：

- `src/components/git-conflict/GitConflictStatusStrip.tsx`
- `src/components/git-conflict/GitConflictOverviewDialog.tsx`
- `src/components/git-conflict/GitConflictMergeDialog.tsx`

保留 `src/components/GitConflictCenter.tsx` 作为兼容入口或薄封装，避免一次性重写 `RightWorkbench`。

建议新增纯 helper：

- `src/lib/git-conflict-resolution.ts`

职责：

- 根据 `GitOperationState` 生成弹窗标题。
- 根据 conflict file detail 生成接受当前/传入/双方的 result 文本。
- 判断是否允许继续操作。
- 统一文件行展示状态。

## 数据流

继续复用现有 API：

- `GET /api/projects/:projectId/git/operation-state`
- `GET /api/projects/:projectId/git/conflicts/file?path=...`
- `POST /api/projects/:projectId/git/conflicts/save-result`
- `POST /api/projects/:projectId/git/conflicts/mark-resolved`
- `POST /api/projects/:projectId/git/operation/continue`
- `POST /api/projects/:projectId/git/operation/abort`
- `POST /api/projects/:projectId/git/pull`

前端状态建议由 `RightWorkbench` 持有：

- `conflictOverviewOpen`
- `mergeDialogPath`
- `activeConflictPath`

`GitConflictStatusStrip` 只负责展示状态和触发回调，不直接持有文件详情。`GitConflictOverviewDialog` 负责读取选中文件详情和执行文件级快捷操作。`GitConflictMergeDialog` 负责编辑 result 并保存。

## 安全与隐私

- 路径仍由后端按项目根目录校验，前端不拼绝对路径。
- 不在 toast、raw events 或 trace 中展示大文件全文。
- Git 失败日志仍放在可展开 toast 详情中。
- 中止操作必须二次确认。
- 不自动 stash、不自动丢弃、不自动覆盖。

## 兼容策略

- 后端接口不变，降低回归风险。
- 旧 `GitConflictCenter` 中已有按钮文案可逐步迁移到新组件。
- 右侧工作台继续在非冲突状态展示审查区和提交入口。
- 当前冲突测试仓库 `D:\project\git-test` 可以继续作为手工验证场景。

## 验收标准

- `blocked_dirty` 状态只提示先处理本地变更，不展示合并拉取确认。
- `diverged` 状态可选择合并拉取或变基拉取，并使用应用内确认条。
- 拉取进入冲突后自动打开或醒目提示打开冲突总览弹窗。
- 总览弹窗能列出冲突文件，并对单文件执行接受当前、接受传入、合并。
- 大尺寸合并编辑器能展示 base、ours、theirs、result，并支持保存和标记解决。
- 所有冲突标记解决后，继续操作变为明确主按钮。
- 中止操作需要二次确认。
- 右侧审查区不再承载完整 merge editor，普通审查高度不被压缩。
- 相关测试覆盖组件 wiring、helper 行为、API 调用和关键文案。
- `npm run typecheck` 通过。
