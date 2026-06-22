# IDEA 式 Git 冲突解决实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前右侧内嵌冲突中心升级为接近 IDEA 的“冲突总览弹窗 + 大尺寸合并编辑器”流程。

**Architecture:** 后端 Git 接口保持不变；前端把冲突状态条、总览弹窗和合并编辑器拆成独立组件。`RightWorkbench` 只负责编排状态和刷新，不承载 merge editor 细节。

**Tech Stack:** React 19、TypeScript、现有 `src/lib/git-api.ts`、Express Git operation-state 接口、现有主题变量和 `src/styles.css`。

---

## 文件结构

- 新增：`src/lib/git-conflict-resolution.ts`
  - 纯函数：标题、文件状态、接受当前/传入/双方 result、继续操作可用性。
- 新增：`src/components/git-conflict/GitConflictStatusStrip.tsx`
  - 展示分叉、阻塞、冲突中、进行中状态和主入口。
- 新增：`src/components/git-conflict/GitConflictOverviewDialog.tsx`
  - 展示冲突文件列表和文件级操作。
- 新增：`src/components/git-conflict/GitConflictMergeDialog.tsx`
  - 大尺寸合并编辑器，负责 result 编辑、保存和标记解决。
- 修改：`src/components/GitConflictCenter.tsx`
  - 收敛为薄封装或迁移出口，避免旧内嵌 resolver 继续承载主流程。
- 修改：`src/components/RightWorkbench.tsx`
  - 持有 dialog open/path 状态，接入新组件。
- 修改：`src/styles.css`
  - 新增 IDEA 式冲突弹窗、合并编辑器和状态条样式。
- 修改：`src/lib/git-conflict-center.test.ts`
  - 更新新组件和流程 wiring 测试。
- 修改：`src/lib/git-api.test.ts`
  - 保持现有 API contract 覆盖，补充文件级快捷操作调用顺序。
- 修改：`src/lib/workbench-layout.test.ts`
  - 确认右侧审查区不再内嵌完整 merge editor。

## Task 1: 锁定 helper 行为

**Files:**

- Create: `src/lib/git-conflict-resolution.ts`
- Test: `src/lib/git-conflict-resolution.test.ts`

- [ ] **Step 1: 写失败测试**

新增 `src/lib/git-conflict-resolution.test.ts`，覆盖这些行为：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConflictOperationTitle,
  buildConflictResolutionContent,
  canContinueGitOperation,
} from './git-conflict-resolution.js';
import type { GitConflictFileDetail, GitOperationState } from '../types';

test('buildConflictOperationTitle describes merge and rebase operations', () => {
  assert.equal(
    buildConflictOperationTitle({
      status: 'conflicted',
      operation: 'merge',
      branch: 'master',
      upstream: 'origin/master',
      remote: 'origin',
      ahead: 1,
      behind: 1,
      hasConflicts: true,
      canContinue: false,
      canAbort: true,
      conflicts: [],
      files: [],
      message: '',
    }),
    '将 origin/master 合并到 master',
  );

  assert.equal(
    buildConflictOperationTitle({
      status: 'conflicted',
      operation: 'rebase',
      branch: 'master',
      upstream: 'origin/master',
      remote: 'origin',
      ahead: 1,
      behind: 1,
      hasConflicts: true,
      canContinue: false,
      canAbort: true,
      conflicts: [],
      files: [],
      message: '',
    }),
    '将 master 变基到 origin/master',
  );
});

test('buildConflictResolutionContent returns current incoming or both content', () => {
  const detail: GitConflictFileDetail = {
    path: 'README.md',
    status: 'UU',
    baseContent: 'base\n',
    currentContent: 'ours\n',
    incomingContent: 'theirs\n',
    resultContent: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n',
  };

  assert.equal(buildConflictResolutionContent(detail, 'current'), 'ours\n');
  assert.equal(buildConflictResolutionContent(detail, 'incoming'), 'theirs\n');
  assert.equal(buildConflictResolutionContent(detail, 'both'), 'ours\ntheirs\n');
});

test('canContinueGitOperation requires no conflicts and a continuable operation', () => {
  const state: GitOperationState = {
    status: 'in_progress',
    operation: 'merge',
    branch: 'master',
    upstream: 'origin/master',
    remote: 'origin',
    ahead: 1,
    behind: 1,
    hasConflicts: false,
    canContinue: true,
    canAbort: true,
    conflicts: [],
    files: [],
    message: '',
  };

  assert.equal(canContinueGitOperation(state), true);
  assert.equal(canContinueGitOperation({ ...state, hasConflicts: true }), false);
  assert.equal(canContinueGitOperation({ ...state, canContinue: false }), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test src/lib/git-conflict-resolution.test.ts`

Expected: 因为 `git-conflict-resolution.ts` 不存在而失败。

- [ ] **Step 3: 实现 helper**

新增 `src/lib/git-conflict-resolution.ts`，导出：

```ts
import type { GitConflictFileDetail, GitOperationState } from '../types';

export type ConflictResolutionChoice = 'current' | 'incoming' | 'both';

export function buildConflictOperationTitle(state: GitOperationState | null) {
  const branch = state?.branch || '当前分支';
  const upstream = state?.upstream || [state?.remote, state?.branch].filter(Boolean).join('/') || '远端分支';

  if (state?.operation === 'rebase') {
    return `将 ${branch} 变基到 ${upstream}`;
  }

  return `将 ${upstream} 合并到 ${branch}`;
}

export function buildConflictResolutionContent(detail: GitConflictFileDetail, choice: ConflictResolutionChoice) {
  if (choice === 'current') {
    return detail.currentContent;
  }
  if (choice === 'incoming') {
    return detail.incomingContent;
  }
  return `${trimTrailingNewline(detail.currentContent)}\n${detail.incomingContent}`;
}

export function canContinueGitOperation(state: GitOperationState | null) {
  return Boolean(state?.canContinue && !state.hasConflicts && state.conflicts.length === 0);
}

function trimTrailingNewline(value: string) {
  return value.replace(/\n+$/g, '');
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npx tsx --test src/lib/git-conflict-resolution.test.ts`

Expected: 3 个测试通过。

## Task 2: 新冲突状态条

**Files:**

- Create: `src/components/git-conflict/GitConflictStatusStrip.tsx`
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/lib/git-conflict-center.test.ts`

- [ ] **Step 1: 写 wiring 测试**

在 `src/lib/git-conflict-center.test.ts` 增加断言：

```ts
test('GitConflictStatusStrip keeps the workbench as a status entry instead of an inline merge editor', () => {
  const rightWorkbenchSource = readFileSync(new URL('../components/RightWorkbench.tsx', import.meta.url), 'utf8');
  const statusStripSource = readFileSync(new URL('../components/git-conflict/GitConflictStatusStrip.tsx', import.meta.url), 'utf8');

  assert.match(rightWorkbenchSource, /GitConflictStatusStrip/);
  assert.match(statusStripSource, /解决冲突/);
  assert.match(statusStripSource, /当前分支与远端分叉/);
  assert.match(statusStripSource, /远端有更新，但工作区存在未提交变更/);
  assert.doesNotMatch(statusStripSource, /<textarea/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 新组件不存在或 `RightWorkbench` 未接入导致失败。

- [ ] **Step 3: 创建状态条组件**

实现 `GitConflictStatusStrip` props：

```ts
import type { GitOperationState, GitPullMode } from '../../types';

type GitConflictStatusStripProps = {
  operationState: GitOperationState;
  onOpenOverview: () => void;
  onRequestPull: (mode: GitPullMode) => void;
  onContinue: () => void;
  onAbort: () => void;
  onRefresh: () => void;
};
```

组件行为：

- `blocked_dirty`：显示阻塞说明和刷新按钮。
- `diverged`：显示合并拉取、变基拉取、刷新按钮。
- `conflicted`：显示解决冲突、继续操作、中止操作、刷新按钮。
- 不渲染冲突文件内容和 textarea。

- [ ] **Step 4: 接入 RightWorkbench**

在 `RightWorkbench` 里用 `GitConflictStatusStrip` 替换旧内嵌中心的顶部状态职责，保留原刷新和 Git 操作回调。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 新增 wiring 测试通过。

## Task 3: 冲突总览弹窗

**Files:**

- Create: `src/components/git-conflict/GitConflictOverviewDialog.tsx`
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/lib/git-conflict-center.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/git-conflict-center.test.ts` 增加：

```ts
test('GitConflictOverviewDialog exposes IDEA-style file list and file-level actions', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictOverviewDialog.tsx', import.meta.url), 'utf8');

  assert.match(source, /接受当前/);
  assert.match(source, /接受传入/);
  assert.match(source, /合并\.\.\./);
  assert.match(source, /继续操作/);
  assert.match(source, /中止操作/);
  assert.match(source, /saveGitConflictResult/);
  assert.match(source, /markGitConflictResolved/);
  assert.match(source, /buildConflictResolutionContent/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 总览弹窗组件不存在导致失败。

- [ ] **Step 3: 创建总览弹窗**

组件 props：

```ts
type GitConflictOverviewDialogProps = {
  open: boolean;
  projectId: string;
  operationState: GitOperationState;
  onClose: () => void;
  onOpenMerge: (path: string) => void;
  onChanged: () => Promise<void> | void;
  onContinue: () => Promise<void> | void;
  onAbort: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};
```

行为：

- `open=false` 返回 `null`。
- 表格渲染 `operationState.conflicts`。
- 点击文件行设置 active path。
- `接受当前` 和 `接受传入` 先读取文件详情，再保存 result，再标记解决，最后刷新。
- `合并...` 调用 `onOpenMerge(path)`。

- [ ] **Step 4: 接入 RightWorkbench 状态**

在 `RightWorkbench` 增加：

```ts
const [conflictOverviewOpen, setConflictOverviewOpen] = useState(false);
const [mergeDialogPath, setMergeDialogPath] = useState('');
```

当 `operationState?.hasConflicts` 从 false 变 true 时，设置 `conflictOverviewOpen=true`。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 总览弹窗相关测试通过。

## Task 4: 大尺寸合并编辑器

**Files:**

- Create: `src/components/git-conflict/GitConflictMergeDialog.tsx`
- Modify: `src/components/git-conflict/GitConflictOverviewDialog.tsx`
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/lib/git-conflict-center.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/git-conflict-center.test.ts` 增加：

```ts
test('GitConflictMergeDialog uses a large result editor and explicit save actions', () => {
  const source = readFileSync(new URL('../components/git-conflict/GitConflictMergeDialog.tsx', import.meta.url), 'utf8');

  assert.match(source, /Base/);
  assert.match(source, /当前 ours/);
  assert.match(source, /传入 theirs/);
  assert.match(source, /Result/);
  assert.match(source, /保存结果/);
  assert.match(source, /保存并标记解决/);
  assert.match(source, /buildConflictResolutionContent\(detail, 'both'\)/);
  assert.match(source, /saveGitConflictResult/);
  assert.match(source, /markGitConflictResolved/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 合并编辑器组件不存在导致失败。

- [ ] **Step 3: 创建合并编辑器**

组件 props：

```ts
type GitConflictMergeDialogProps = {
  open: boolean;
  projectId: string;
  filePath: string;
  onClose: () => void;
  onResolved: () => Promise<void> | void;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
};
```

行为：

- 打开后读取 `fetchGitConflictFile(projectId, filePath)`。
- `resultContent` 放进本地 state。
- `接受当前`、`接受传入`、`接受双方`只更新 result state。
- `保存结果` 调用 `saveGitConflictResult`。
- `保存并标记解决` 调用 `saveGitConflictResult` 后调用 `markGitConflictResolved`，再调用 `onResolved()`。

- [ ] **Step 4: 接入总览和工作台**

`GitConflictOverviewDialog` 的 `合并...` 设置 `mergeDialogPath`。`RightWorkbench` 渲染 `GitConflictMergeDialog`，关闭或 resolved 后回到总览。

- [ ] **Step 5: 运行测试**

Run: `npx tsx --test src/lib/git-conflict-center.test.ts`

Expected: 合并编辑器测试通过。

## Task 5: 样式和布局

**Files:**

- Modify: `src/styles.css`
- Modify: `src/lib/workbench-layout.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/workbench-layout.test.ts` 增加：

```ts
test('IDEA-style conflict dialogs are not constrained by the right workbench column', () => {
  assert.match(stylesSource, /\.git-conflict-overview-dialog/);
  assert.match(stylesSource, /\.git-conflict-merge-dialog/);
  assert.match(stylesSource, /\.git-conflict-merge-grid/);
  assert.match(stylesSource, /width:\s*min\(1180px,\s*calc\(100vw - 96px\)\)/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test src/lib/workbench-layout.test.ts`

Expected: 新样式不存在导致失败。

- [ ] **Step 3: 新增样式**

在 `src/styles.css` 添加：

- `.git-conflict-status-strip`
- `.git-conflict-overview-dialog`
- `.git-conflict-overview-table`
- `.git-conflict-merge-dialog`
- `.git-conflict-merge-grid`
- `.git-conflict-merge-pane`
- `.git-conflict-result-editor`

约束：

- 复用主题变量，不写死浅色/深色大块背景。
- modal 宽度使用 `width: min(1180px, calc(100vw - 96px));`。
- 移动或窄屏退化为单列滚动。
- 按钮复用现有 `.dialog-button`、`.ghost-button` 或同等样式。

- [ ] **Step 4: 运行布局测试**

Run: `npx tsx --test src/lib/workbench-layout.test.ts`

Expected: 新布局测试通过。

## Task 6: 回归验证

**Files:**

- No source edits unless verification finds a bug.

- [ ] **Step 1: 跑相关单测**

Run:

```bash
npx tsx --test src/lib/git-conflict-resolution.test.ts src/lib/git-conflict-center.test.ts src/lib/git-api.test.ts src/lib/workbench-layout.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 跑类型检查**

Run:

```bash
npm run typecheck
```

Expected: `tsc -b` 退出码为 0。

- [ ] **Step 3: 手工验证 blocked_dirty**

用本地 Git 测试仓库制造或保留未跟踪文件，确认：

- 右侧显示“远端有更新，但工作区存在未提交变更”。
- 不显示合并拉取主按钮。
- 审查区展示未跟踪文件。

- [ ] **Step 4: 手工验证冲突总览**

让本地 Git 测试仓库处于 `ahead 1, behind 1`，点击合并拉取：

- 应出现应用内确认条。
- Git 进入冲突后，总览弹窗打开。
- 文件列表出现 `README.md`。
- `接受传入` 能保存远端内容并标记解决。

- [ ] **Step 5: 手工验证合并编辑器**

重新制造冲突，点击 `合并...`：

- 大尺寸合并编辑器显示 Base、当前 ours、传入 theirs、Result。
- `接受双方` 更新 Result，但不立即标记解决。
- `保存并标记解决` 后回到总览。
- 所有文件解决后，`继续操作` 可点击。

- [ ] **Step 6: 手工验证继续和中止**

分别验证：

- 所有冲突解决后 `继续操作` 可完成 merge/rebase。
- `中止操作` 需要二次确认。
- 操作失败 toast 可以展开真实 Git 输出。

## 风险

- `RightWorkbench.tsx` 可能继续变大；实现时只做状态编排，把内容放进 `src/components/git-conflict/**`。
- 大尺寸 modal 容易和桌面窗口材质样式冲突；需要同时看 Web 和桌面观感。
- 文件级接受当前/传入会直接标记解决；按钮文案必须清楚，避免用户误以为只是预览。
- 旧内嵌 resolver 删除时要保留 API 调用测试，避免冲突流程只在 UI 上看起来存在。
