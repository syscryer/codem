# Git 历史车道图问题说明

## 背景

仓库：`D:\cursor_project\codem`

当前在实现 Git 日志面板的车道图，位置在 Git 日志三栏面板中间提交列表左侧。目标效果参考 VSCode / IDEA：

- 每条提交行固定高度。
- 提交圆点和提交文本垂直居中。
- 同一条 lane 的竖线连续不断开。
- merge / shift 线使用贝塞尔曲线。
- hover / active 行背景不能把线条切断。
- 多分支、多 merge 场景下，颜色、lane、曲线连接要稳定。

## 相关文件

- 前端面板：`src/components/GitHistoryPanel.tsx`
- 图形 helper：`src/lib/git-graph-visual.ts`
- helper 测试：`src/lib/git-graph-visual.test.ts`
- 样式：`src/styles.css`
- 后端 Git 日志与 lane 数据：`server/lib/workspace-store.ts`
- 类型定义：`src/types.ts`

## 后端当前数据结构

后端 `server/lib/workspace-store.ts` 通过 `git log --graph --topo-order --decorate=short ...` 读取日志，并生成两套图信息：

```ts
graphText: string;
graph: GitHistoryGraphRow;
```

类型在 `src/types.ts`：

```ts
export type GitHistoryGraphLaneSegment = {
  lane: number;
  fromLane?: number;
  colorIndex: number;
  kind: 'vertical' | 'start' | 'end' | 'merge-left' | 'merge-right' | 'shift-left' | 'shift-right';
};

export type GitHistoryGraphRow = {
  lane: number;
  colorIndex: number;
  segmentsBefore: GitHistoryGraphLaneSegment[];
  segmentsAfter: GitHistoryGraphLaneSegment[];
};
```

`buildGitHistoryGraphRows()` 自己维护 `activeLanes`，给每个 commit 生成：

- `lane`：当前提交圆点所在 lane。
- `segmentsBefore`：当前行圆点上方的 lane 片段，目前基本只有 vertical。
- `segmentsAfter`：当前行圆点下方的 lane 片段，包含 vertical / merge / shift 等。

## 已尝试方案

### 方案 1：直接显示 Git 原生 graphText

最早直接把 `graphText` 用 `<pre>` 显示。

问题：

- 视觉不够接近 VSCode / IDEA。
- 字符图线条粗细、颜色、圆点、曲线都不好控制。

### 方案 2：每行基于 graphText 转 SVG

新增 `src/lib/git-graph-visual.ts`，把：

- `*` 转圆点。
- `|` 转竖线。
- `/`、`\` 转贝塞尔曲线。

问题：

- 一个 commit 的 `graphText` 可能有多行。
- 固定行高时，`*` 圆点不一定在提交文本中心。
- 如果为了对齐文本，把单行 SVG 内部整体偏移到圆点居中，不同行的偏移量不同，跨行竖线会断开。

结论：`graphText` 适合文本展示，不适合固定行高的 UI SVG 渲染。

### 方案 3：每行基于 graph.segmentsBefore / segmentsAfter 转 SVG

当前尝试改为优先使用 `commit.graph`：

```tsx
const visual = buildGitGraphVisual(commit.graphText, {
  graph: commit.graph,
  height: GIT_HISTORY_LOG_ROW_HEIGHT,
});
```

每行单独渲染一个 SVG：

- `segmentsBefore.vertical` 从行顶画到圆点中心。
- `segmentsAfter.vertical` 从圆点中心画到行底。
- `segmentsAfter.shift/merge` 从 `fromLane` 的圆点中心画曲线到目标 lane 行底。

问题：

- 仍然是“每行一个 SVG”，跨行连续性靠上下 overdraw。
- hover / active 背景、行边界、曲线端点仍容易出现视觉断开。
- 某些 lane 在相邻行的 x 或颜色不稳定时，看起来会错位。

### 方案 4：列表级一整张 SVG 覆盖左侧图列

当前最新尝试：

- 中间提交列表新增 `.git-history-log-body`。
- 在 body 内渲染一张绝对定位的 `.git-history-graph-timeline` SVG。
- 每个提交 row 只保留左侧空 graph cell 占位。
- 整张 SVG 高度为 `commits.length * rowHeight`。
- 所有节点和线条使用同一个 y 坐标系：
  - row 0 圆点 y = `rowHeight / 2`
  - row 1 圆点 y = `rowHeight + rowHeight / 2`
  - 以此类推

验证结果：

- DOM 里只有 1 张 timeline SVG。
- 每行内部不再有单独 SVG。
- 前 12 行 `nodeCenter` 和 `textCenter` 都一致。

但用户截图里仍然觉得“不行”，表现为车道图连接和视觉关系仍不自然。

## 当前核心疑点

目前更可能是后端 lane 数据语义不足或 lane 算法不准确，而不是 SVG 是否一张的问题。

重点疑点：

1. `segmentsBefore` 只有 vertical，无法表达“上一行曲线进入当前圆点上半段”的关系。
2. `segmentsAfter` 把 shift / merge 统一画成从圆点中心到下一行底部，但真实 Git 图可能需要区分：
   - 当前提交自己的第一父节点延续。
   - 第二父节点新增 lane。
   - 已有 lane 的位置重排。
   - merge 线从侧边进入当前提交，而不是从当前提交出去。
3. `fromLane` 和 `lane` 在 `merge-left / merge-right / shift-left / shift-right` 里的语义可能被前端解释错。
4. `buildGitHistoryGraphRows()` 自己模拟 Git lane，可能和 Git 原生 `--graph` 的 lane 排布不一致。
5. 当前数据只有每行的 before/after segment，没有表达跨两行的完整 edge，比如：
   - edge 从 row i 的 lane A 到 row i+1 的 lane B。
   - edge 是直线、曲线、merge 入线、branch 出线。
6. 对 merge commit 来说，线的方向可能错了。现在多是从当前节点向下画出去，但视觉上有些 merge 应该是从上方某 lane 曲线汇入当前节点。

## 建议 CC 重点检查

请优先检查这两个函数：

```ts
// server/lib/workspace-store.ts
function buildGitHistoryGraphRows(commits: RawGitHistoryLogEntry[]): GitHistoryLogCommit[]

// src/lib/git-graph-visual.ts
function buildGitGraphTimelineVisual(graphs: GitHistoryGraphRow[], options?: GitGraphTimelineVisualOptions): GitGraphVisual
```

需要判断：

- `GitHistoryGraphRow` 当前结构是否足够表达 IDEA / VSCode 风格车道图。
- `buildGitHistoryGraphRows()` 对 merge commit 的 lane 分配是否正确。
- `segmentsBefore` / `segmentsAfter` 是否应该替换为更明确的 edge 模型。

## 可能更合理的数据模型

建议考虑后端直接输出 timeline edge，而不是 before/after 片段：

```ts
type GitHistoryGraphEdge = {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  colorIndex: number;
  kind: 'vertical' | 'curve' | 'merge' | 'branch';
};

type GitHistoryGraphNode = {
  row: number;
  lane: number;
  colorIndex: number;
};
```

这样前端可以一次性画整张图：

- node 用 `row/lane` 定位。
- edge 用 `fromRow/fromLane -> toRow/toLane` 定位。
- 竖线和曲线都跨行连续，不需要每行猜测 before/after。

## 当前验证命令

```powershell
node --import tsx --test src\lib\git-graph-visual.test.ts
npm run typecheck
```

## 当前工作区状态

当前有未提交修改：

- `src/components/GitHistoryPanel.tsx`
- `src/styles.css`
- `src/lib/git-graph-visual.ts`
- `src/lib/git-graph-visual.test.ts`

不要提交这些本地产物：

- `.superpowers/`
- `desktop-dev.log`
- `server-dev.err.log`
- `server-dev.log`
- `web-dev.err.log`
- `web-dev.log`
