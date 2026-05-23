# Git 日志 IDEA 化改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CodeM 当前 Git 日志面板升级成接近 IDEA 的日志浏览器，支持真实 commit graph、按分支/用户/日期/路径筛选、顶部纯工具栏、三栏拖拽分割，以及右侧默认目录树文件视图。

**Architecture:** 后端新增日志浏览器接口，直接从 Git 历史中返回包含 `parents`、`refs` 与 graph lane 信息的结构化提交数据；前端基于新接口重做顶部工具栏、三栏布局、中间提交区和右侧详情区，同时复用现有提交详情与文件预览弹窗链路。高复杂度逻辑拆到独立 helper，避免继续把复杂度堆进单一组件。

**Tech Stack:** React、TypeScript strict mode、Express、Node.js、`node:test`、现有 Git API 与 Diff Viewer

---

## 文件结构

### 后端

- 修改 `server/index.ts`
  - 暴露新的 `GET /api/projects/:projectId/git/history/log`
- 修改 `server/lib/workspace-store.ts`
  - 新增日志浏览器查询
  - 扩展提交数据结构
  - 新增 graph lane 计算
- 修改 `server/lib/workspace-store-git.test.ts`
  - 补日志接口与 graph 计算测试

### 前端

- 修改 `src/types.ts`
  - 新增日志接口与 graph 类型
- 修改 `src/lib/git-api.ts`
  - 新增日志浏览器请求函数
- 新增 `src/lib/git-history-graph.ts`
  - graph 渲染辅助
- 新增 `src/lib/git-history-graph.test.ts`
  - graph helper 测试
- 新增 `src/lib/git-history-file-tree.ts`
  - 右侧提交详情文件树 helper
- 新增 `src/lib/git-history-file-tree.test.ts`
  - 文件树 helper 测试
- 修改 `src/components/GitHistoryPanel.tsx`
  - 接入新接口
  - 重写提交区布局与筛选
  - 改造右侧详情区
- 修改 `src/styles.css`
  - 新增 Git 日志相关样式

## Task 1: 为日志浏览器定义数据契约

**Files:**
- Modify: `src/types.ts`
- Modify: `server/lib/workspace-store.ts`
- Test: `server/lib/workspace-store-git.test.ts`

- [ ] **Step 1: 写后端测试，约束日志返回结构必须包含 parents、refs、graph**

在 `server/lib/workspace-store-git.test.ts` 新增测试，目标断言：

```ts
assert.equal(Array.isArray(payload.commits), true);
assert.equal(payload.commits.length > 0, true);
assert.equal(Array.isArray(payload.commits[0].parents), true);
assert.equal(Array.isArray(payload.commits[0].refs), true);
assert.equal(typeof payload.commits[0].graph?.lane, 'number');
assert.equal(Array.isArray(payload.commits[0].graph?.segmentsBefore), true);
assert.equal(Array.isArray(payload.commits[0].graph?.segmentsAfter), true);
```

- [ ] **Step 2: 只跑新增测试，确认当前失败**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- 新增测试失败
- 失败原因是当前日志接口没有 `parents / refs / graph`

- [ ] **Step 3: 扩展前后端共享类型**

在 `src/types.ts` 与 `server/lib/workspace-store.ts` 对齐新增：

```ts
export type GitHistoryGraphLaneSegment = {
  lane: number;
  kind: 'vertical' | 'start' | 'end' | 'merge-left' | 'merge-right';
};

export type GitHistoryGraphRow = {
  lane: number;
  colorIndex: number;
  segmentsBefore: GitHistoryGraphLaneSegment[];
  segmentsAfter: GitHistoryGraphLaneSegment[];
};

export type GitHistoryLogCommit = {
  sha: string;
  shortSha: string;
  summary: string;
  message: string;
  author: string;
  authorEmail: string;
  commitTime: number;
  parents: string[];
  refs: string[];
  graph: GitHistoryGraphRow;
};

export type GitHistoryLogResponse = {
  commits: GitHistoryLogCommit[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  availableAuthors: string[];
  activeRefs: string[];
};
```

- [ ] **Step 4: 重新运行测试，确认类型与结构准备完成**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- 仍有失败
- 但失败点应进入“真实实现尚未完成”，而不是类型缺失

## Task 2: 新增日志浏览器后端接口与筛选

**Files:**
- Modify: `server/index.ts`
- Modify: `server/lib/workspace-store.ts`
- Test: `server/lib/workspace-store-git.test.ts`

- [ ] **Step 1: 写筛选测试**

新增测试覆盖：

```ts
assert.equal(filteredByAuthor.commits.every((commit) => commit.author === 'CodeM Test'), true);
assert.equal(filteredByPath.commits.every((commit) => commit.message || commit.summary), true);
assert.equal(filteredByRef.commits.length > 0, true);
```

同时准备至少一个带 merge 的测试仓库。

- [ ] **Step 2: 运行测试，确认失败**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- 新增 `/git/history/log` 相关测试失败

- [ ] **Step 3: 在 `server/lib/workspace-store.ts` 实现日志查询函数**

新增形如：

```ts
export async function listProjectGitHistoryLog(
  projectId: string,
  options: {
    refs?: string[];
    authors?: string[];
    dateFrom?: string;
    dateTo?: string;
    paths?: string[];
    search?: string;
    limit?: number;
    cursor?: string | null;
  },
): Promise<GitHistoryLogResponse> {
  // 读取 git log
  // 解析 commit + parents + refs
  // 计算 graph
  // 生成 nextCursor
}
```

命令构造优先基于：

```ts
[
  'log',
  '--date-order',
  '--decorate=short',
  '--parents',
  '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%B%x1e',
]
```

- [ ] **Step 4: 在 `server/index.ts` 暴露新接口**

新增路由：

```ts
app.get('/api/projects/:projectId/git/history/log', async (request, response) => {
  // 读取 refs/authors/dateFrom/dateTo/paths/search/limit/cursor
  // 调用 listProjectGitHistoryLog
});
```

- [ ] **Step 5: 重新运行后端测试**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- `/git/history/log` 相关测试通过

## Task 3: 把 graph 计算拆成可测试逻辑

**Files:**
- Modify: `server/lib/workspace-store.ts`
- Test: `server/lib/workspace-store-git.test.ts`

- [ ] **Step 1: 写 merge graph 测试**

准备一个带 merge commit 的仓库，断言：

```ts
const mergeCommit = payload.commits.find((commit) => commit.parents.length > 1);
assert.equal(Boolean(mergeCommit), true);
assert.equal(
  mergeCommit?.graph.segmentsAfter.some((segment) => segment.kind === 'merge-left' || segment.kind === 'merge-right'),
  true,
);
```

- [ ] **Step 2: 运行测试，确认 graph 失败**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- merge graph 断言失败

- [ ] **Step 3: 在后端实现最小 graph lane 算法**

在 `server/lib/workspace-store.ts` 新增内部 helper：

```ts
function buildGitHistoryGraphRows(
  commits: Array<{
    sha: string;
    parents: string[];
  }>,
): GitHistoryGraphRow[] {
  // 维护 active lanes
  // 给每个 commit 分配 lane 和 segments
}
```

首版只要求：

- 单线历史正确
- merge commit 有分叉线
- lane 稳定，不闪烁

- [ ] **Step 4: 重跑测试**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
```

Expected:

- merge graph 断言通过

## Task 4: 为前端新增日志 API 与 graph helper

**Files:**
- Modify: `src/lib/git-api.ts`
- Add: `src/lib/git-history-graph.ts`
- Add: `src/lib/git-history-graph.test.ts`

- [ ] **Step 1: 写 graph helper 测试**

新增测试断言：

```ts
assert.equal(buildGraphColumns(sampleCommit.graph).length > 0, true);
assert.equal(buildGraphColumns(sampleMergeCommit.graph).some((segment) => segment.kind.includes('merge')), true);
```

- [ ] **Step 2: 运行前端 helper 测试，确认失败**

Run:

```powershell
node --import tsx --test src/lib/git-history-graph.test.ts
```

Expected:

- helper 不存在或断言失败

- [ ] **Step 3: 实现前端 API 与 graph helper**

在 `src/lib/git-api.ts` 新增：

```ts
export async function fetchGitHistoryLog(projectId: string, options?: {
  refs?: string[];
  authors?: string[];
  dateFrom?: string;
  dateTo?: string;
  paths?: string[];
  search?: string;
  limit?: number;
  cursor?: string | null;
}) {
  // URLSearchParams 拼接并请求 /git/history/log
}
```

在 `src/lib/git-history-graph.ts` 新增：

```ts
export function buildGitHistoryGraphColumns(row: GitHistoryGraphRow) {
  return row;
}
```

首版只做薄封装，避免过度设计。

- [ ] **Step 4: 重新运行 helper 测试**

Run:

```powershell
node --import tsx --test src/lib/git-history-graph.test.ts
```

Expected:

- 测试通过

## Task 5: 为右侧详情区实现目录树 helper

**Files:**
- Add: `src/lib/git-history-file-tree.ts`
- Add: `src/lib/git-history-file-tree.test.ts`

- [ ] **Step 1: 写文件树测试**

测试输入：

```ts
[
  { path: 'src/components/GitHistoryPanel.tsx', status: '修改', additions: 1, deletions: 1, binary: false },
  { path: 'src/styles.css', status: '修改', additions: 2, deletions: 0, binary: false },
]
```

断言：

```ts
assert.equal(tree.length > 0, true);
assert.equal(tree[0]?.type, 'dir');
assert.equal(flattenCount(tree) >= 2, true);
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```powershell
node --import tsx --test src/lib/git-history-file-tree.test.ts
```

Expected:

- helper 不存在或断言失败

- [ ] **Step 3: 实现最小文件树 helper**

新增：

```ts
export type GitHistoryFileTreeNode =
  | { type: 'dir'; name: string; path: string; children: GitHistoryFileTreeNode[] }
  | { type: 'file'; name: string; path: string; file: GitHistoryCommitFile };

export function buildGitHistoryFileTree(files: GitHistoryCommitFile[]): GitHistoryFileTreeNode[] {
  // 按 / 切分目录
}
```

- [ ] **Step 4: 重新运行测试**

Run:

```powershell
node --import tsx --test src/lib/git-history-file-tree.test.ts
```

Expected:

- 测试通过

## Task 6: 改造 GitHistoryPanel 主视图

**Files:**
- Modify: `src/components/GitHistoryPanel.tsx`
- Modify: `src/styles.css`
- Test: `src/lib/git-history-graph.test.ts`
- Test: `src/lib/git-history-file-tree.test.ts`

- [ ] **Step 1: 先接新数据源，保留旧 UI，确认数据能进来**

把中间历史读取改成：

```ts
const [historyLog, setHistoryLog] = useState<GitHistoryLogResponse | null>(null);
```

并用新接口替换：

```ts
const nextHistory = await fetchGitHistoryLog(project.id, { refs: [selectedBranchName], limit: 80 });
```

- [ ] **Step 2: 本地验证类型通过**

Run:

```powershell
npm run typecheck
```

Expected:

- TypeScript 无错误

- [ ] **Step 3: 改造提交区布局**

重做中间区为：

- 顶部纯工具栏
- 筛选条
- 列头
- graph + 提交信息 + 作者 + 时间

保留选中提交逻辑，不要一次把所有行为推翻。

- [ ] **Step 4: 改造左侧分支树顶部搜索与 HEAD 行语义**

新增左侧搜索输入框：

```ts
const [branchTreeSearch, setBranchTreeSearch] = useState('');
```

要求：

- placeholder 为“分支或标签”
- 只过滤左侧分支树显示，不触发日志接口重查
- `HEAD(当前分支)` 保持单独状态行
- 不再在 `HEAD(当前分支)` 下重复渲染当前分支节点
- 当前分支正常保留在 `本地` 分组中
- 左侧新增单独的 `标签` 分组，默认折叠
- 搜索命中标签时自动展开 `标签` 分组
- 中间分支筛选允许选择标签 ref

- [ ] **Step 5: 为三栏加入可拖拽分割线**

新增局部布局状态，管理左侧和右侧宽度：

```ts
const [leftPaneWidth, setLeftPaneWidth] = useState<number>(280);
const [rightPaneWidth, setRightPaneWidth] = useState<number>(360);
```

要求：

- 左右分割线均可拖拽
- 三栏最小宽度固定约束
- 拖拽时不触发日志重查
- 拖拽视觉样式与现有面板分割线统一

- [ ] **Step 6: 改造右侧详情区**

新增局部状态：

```ts
const [detailsDisplayMode, setDetailsDisplayMode] = useState<'tree' | 'flat'>('tree');
const [expandedDetailDirs, setExpandedDetailDirs] = useState<Record<string, boolean>>({});
```

默认目录树，支持切平铺。

- [ ] **Step 7: 保持双击文件弹窗预览不变**

确认以下逻辑仍成立：

```ts
onDoubleClick={() => openHistoryPreview(index)}
```

- [ ] **Step 8: 补样式并保证主题联动**

`src/styles.css` 新增：

- 顶部工具栏
- 左侧搜索框
- 三栏拖拽分割线
- graph 列
- 筛选条
- 右侧详情布局
- 目录/平铺切换
- merge 线、节点、徽标

要求全部走现有主题变量，不写死浅色背景。

- [ ] **Step 9: 运行类型检查与 helper 测试**

Run:

```powershell
node --import tsx --test src/lib/git-history-graph.test.ts
node --import tsx --test src/lib/git-history-file-tree.test.ts
npm run typecheck
```

Expected:

- 全部通过

## Task 7: 浏览器联调与回归

**Files:**
- Modify: `src/components/GitHistoryPanel.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 手工验证 merge graph、筛选与详情切换**

验证项：

- 顶部只保留工具栏，没有额外文字标题栏
- 左右分割线都可拖拽
- 拖拽后各栏宽度变化符合预期
- 左侧分支树正常
- 左侧“分支或标签”搜索生效
- `HEAD(当前分支)` 下不再重复出现当前分支子节点
- 左侧 `标签` 分组存在且默认折叠
- 搜索标签名时可命中并展开 `标签` 分组
- 中间 graph 与 merge 线可见
- 分支筛选生效
- 用户筛选生效
- 日期筛选生效
- 路径筛选生效
- 右侧默认目录树正常
- 切到平铺正常
- 双击文件仍弹出预览

- [ ] **Step 2: 修复浏览器验证发现的问题**

只修真实问题，不加兜底视觉补丁。

- [ ] **Step 3: 最终验证**

Run:

```powershell
node --import tsx --test server/lib/workspace-store-git.test.ts
node --import tsx --test src/lib/git-history-graph.test.ts
node --import tsx --test src/lib/git-history-file-tree.test.ts
npm run typecheck
```

Expected:

- 全绿

## 自检结论

- 设计文档中的核心需求均已覆盖：
  - graph
  - 筛选
  - 右侧目录树/平铺
  - 弹窗预览保持
  - 性能边界
- 计划中的新增文件与类型名称保持一致
- 实施顺序遵循先测试、后实现、再联调的节奏
