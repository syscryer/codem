# Task: Right Workbench

## Objective

为 CodeM 增加一个可收缩的右侧工作台。

这个工作台不是 Git 专用面板，而是一个可扩展工具容器。第一版先接入：

- `概览`：展示当前项目、会话、运行状态、Git 摘要等轻量信息。
- `文件`：默认展示项目文件树，可切换到已更改文件 + diff 预览。
- `浏览器`：先做空壳，包含导航按钮、URL 输入和空白页。
- `文件预览`：从 AI 写入/修改文件卡片打开，作为工作台内的文档 tab 展示。

## Product Contract

- 顶栏最右侧分栏按钮控制整个右侧工作台展开/收起。
- 顶栏文件夹图标是单按钮，点击打开右侧工作台并进入 `文件 / 所有文件`。
- 顶栏 Git diff chip（例如 `+60 -6`）点击后打开工作台并进入 `文件 / 已更改文件`。
- 文件工作台左侧是预览区，右侧是文件树；所有文件和已更改文件都使用树形展示。
- 右侧工作台关闭时，聊天区域吃满主内容区宽度。
- 右侧工作台打开时，聊天区域不应出现横向滚动，底部输入框仍可正常使用。
- 提交弹窗继续保留，右侧工作台只负责常驻审查和工具查看。
- AI 写入/修改文件后的文件卡片点击“打开”，应在右侧工作台中打开文件预览 tab，而不是只跳外部编辑器。
- 工作台允许同时打开多个文件 tab，例如 `right-workbench.md`、`task_plan.md`。

## Out Of Scope

第一版不做：

- 真实文本编辑器保存。
- 复杂文件写入、冲突保护、未保存状态。
- 真实内嵌浏览器加载页面。
- 工作台宽度拖拽。
- 一次性递归扫描完整项目目录。
- 桌面壳或 Tauri 专属能力。

## Suggested Files

前端：

- `src/App.tsx`
- `src/components/ChatHeader.tsx`
- `src/components/RightWorkbench.tsx`
- `src/lib/project-files-api.ts`
- `src/lib/git-api.ts`
- `src/types.ts`
- `src/styles.css`

后端：

- 新增轻量目录读取接口 `/api/projects/:projectId/files?path=...`，只读取指定目录一级内容。
- 已更改文件复用当前 `/api/projects/:projectId/git/status` 和 `/api/projects/:projectId/git/diff`。

## State Design

建议在 `App.tsx` 暂存顶层状态：

```ts
type RightWorkbenchTab = 'overview' | 'files' | 'browser' | `file:${string}`;
type WorkbenchFileScope = 'all' | 'changed';

const [rightWorkbenchOpen, setRightWorkbenchOpen] = useState(false);
const [rightWorkbenchTab, setRightWorkbenchTab] = useState<RightWorkbenchTab>('overview');
const [rightWorkbenchFileScope, setRightWorkbenchFileScope] = useState<WorkbenchFileScope>('all');
const [rightWorkbenchFiles, setRightWorkbenchFiles] = useState<WorkbenchFileTab[]>([]);
```

后续如果状态变多，再抽成 `useRightWorkbench`。

## Component Contract

```tsx
type RightWorkbenchProps = {
  open: boolean;
  activeTab: RightWorkbenchTab;
  activeProject: ProjectSummary | null;
  activeThread: ThreadDetail | null;
  isRunning: boolean;
  files: WorkbenchFileTab[];
  onSelectTab: (tab: RightWorkbenchTab) => void;
  onOpenFile: (file: WorkbenchFileTab) => void;
  onCloseFile: (filePath: string) => void;
  onClose: () => void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};
```

`RightWorkbench` 内部再拆：

- `WorkbenchTabs`
- `WorkbenchOverview`
- `WorkbenchReview`
- `WorkbenchBrowserShell`
- `WorkbenchFilePreview`

如果第一版想更轻，可以先放在一个文件里，但不要继续塞进 `App.tsx`。

## Layout Plan

主内容建议从：

```text
main.chat-shell
```

调整为：

```text
div.chat-workspace
  main.chat-shell
  aside.right-workbench
```

行为：

- `rightWorkbenchOpen=false`：`right-workbench` 不渲染或宽度为 0。
- `rightWorkbenchOpen=true`：`right-workbench` 宽度 `min(720px, 48vw)`。
- 小屏先保持可用，后续再做覆盖抽屉。

## Files Tab

第一版功能：

- 默认进入 `所有文件`，读取项目根目录。
- 点击文件夹后懒加载该文件夹一级内容，不一次性递归扫描完整项目。
- 点击普通文件后，在左侧预览区打开文件 tab。
- Markdown 文件默认渲染阅读视图，普通代码文件显示只读代码预览。
- 通过标题下拉在 `所有文件` 与 `已更改文件` 间切换。
- `已更改文件` 模式读取 Git status，将变更路径组装成虚拟目录树。
- 点击已更改文件后读取该文件 diff。
- 已更改文件点击后，在左侧预览区打开 diff tab。
- 有刷新按钮。
- 没有 Git 仓库或无变更时展示空态。

复用现有能力：

- `fetchProjectFiles(projectId, directory)`
- `fetchGitStatus(projectId)`
- `fetchGitFileDiff(projectId, filePath)`
- diff 颜色可复用提交弹窗里的 `.git-diff-line` 样式。

## Browser Tab

第一版功能：

- 顶部：后退、前进、刷新、URL 输入、打开图标。
- 内容区：显示“空白页”。
- URL 输入暂不触发真实加载。
- 后续可接 in-app browser、Tauri WebView 或外部浏览器。

## File Preview Tabs

第一版功能：

- 消息里的写入/修改文件卡片提供“打开”入口。
- 点击后打开右侧工作台，并创建或激活对应文件 tab。
- tab 标题显示文件名，例如 `task_plan.md`。
- 面包屑显示项目名和相对路径。
- Markdown 文件用渲染视图展示，优先支持标题、列表、表格、inline code、code block。
- 其他文本文件用只读代码预览展示。
- 二进制或过大文件显示不可预览空态。
- 文件预览只读，不支持保存。

复用现有能力：

- 后端已有 `/api/system/file-preview`，可读取项目内文本文件。
- Markdown 渲染可复用当前对话正文的 `react-markdown + remark-gfm` 依赖。

文件 tab 交互：

- 同一路径重复打开时激活已有 tab，不重复创建。
- 每个文件 tab 可关闭。
- 关闭当前文件 tab 后，优先回到左侧相邻 tab；没有文件 tab 时回到 `overview` 或上一个固定 tab。

## Header Integration

`ChatHeader` 需要新增 props：

```ts
rightWorkbenchOpen: boolean;
onToggleRightWorkbench: () => void;
onOpenFilesWorkbench: () => void;
onOpenReviewWorkbench: () => void;
onOpenWorkbenchFile: (filePath: string) => void;
```

入口行为：

- 最右分栏按钮：`onToggleRightWorkbench`。
- 文件夹图标：`onOpenFilesWorkbench`，打开工作台并进入 `文件 / 所有文件`。
- Git diff chip：`onOpenReviewWorkbench`，打开工作台并进入 `文件 / 已更改文件`，同时可以刷新 Git summary。
- 文件卡片“打开”：`onOpenWorkbenchFile(filePath)`，打开工作台并切到文件 tab。

## Implementation Phases

| Phase | Status | Deliverable |
| --- | --- | --- |
| 1. Skeleton | completed | 已新增 `RightWorkbench` 组件和 tabs 空壳 |
| 2. Layout | completed | 已新增 `chat-workspace` 两栏布局，支持工作台收起/展开 |
| 3. Header wiring | completed | 最右按钮、文件夹按钮和 Git diff chip 已接入工作台状态 |
| 4. Files tab | completed | 所有文件懒加载树 + 已更改文件虚拟树 + diff 预览 + 空态 + 刷新 |
| 5. File preview tabs | in_progress | 所有文件点击可打开预览 tab；Markdown 渲染和普通代码只读预览已接入；写入文件卡片入口待接入 |
| 6. Browser shell | pending | URL 输入和空白页壳 |
| 7. Polish | pending | 对齐截图视觉，避免横向滚动和输入框挤压 |
| 8. Validation | in_progress | 骨架阶段已通过 `npm run typecheck`，后续功能接入后继续验证 |

## Validation Checklist

- 打开页面时默认不强制展开工作台。
- 点击最右分栏按钮可以展开和收起。
- 点击文件夹按钮会展开工作台并切到 `文件 / 所有文件`。
- 点击 `+N -N` 会展开工作台并切到 `文件 / 已更改文件`。
- 工作台打开后输入框仍可输入、发送、停止。
- 文件页能看到项目根目录和可展开文件夹。
- 已更改文件模式能看到当前变更文件。
- 点击文件能切换 diff。
- 点击所有文件里的普通文件能打开预览 tab。
- Markdown 文件默认显示渲染后的阅读视图。
- AI 写入文件卡片点击打开后，工作台显示文件 tab。
- Markdown 文件能以渲染视图预览。
- 同一文件重复打开不会重复创建 tab。
- 无 Git 仓库和无变更都有明确空态。
- `npm run typecheck` 通过。

## Risks

- `App.tsx` 继续膨胀：用 `RightWorkbench` 承接 UI，避免把审查页写进 `App.tsx`。
- Git 请求重复：第一版可接受，后续再抽共享 hook。
- 宽度挤压：先用固定宽度和 `minmax(0, 1fr)`，避免横向滚动。
- 浏览器期望过高：第一版明确是 shell，不承诺真实加载。
- 文件预览权限：只允许预览当前已登记项目内文件，继续走 `/api/system/file-preview` 的路径权限校验。
- Markdown 渲染安全：只渲染本地文件内容，不执行其中脚本或外部指令。
