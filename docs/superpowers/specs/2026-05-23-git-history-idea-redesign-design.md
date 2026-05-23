# Git 日志 IDEA 化改版设计

## 背景

当前 Git 日志面板已经具备基础能力：

- 左侧可查看本地/远程分支
- 中间可查看提交历史
- 右侧可查看提交详情和修改文件
- 双击文件可弹出 Diff 预览

但整体仍停留在“功能可用”的阶段，与用户期望的 IDEA 风格差距较大，主要问题包括：

- 提交历史区缺少真实分支/合并图
- 顶部缺少按分支、用户、日期、路径筛选
- 提交行信息密度不足，无法快速定位作者、时间、引用
- 右侧详情区仍是简单列表，不支持默认目录树展示
- 历史接口只有 `ref + limit`，不适合做日志浏览器

用户已确认本次改版目标：

1. 左侧保留分支树，并继续沿用当前本地/远程分组
2. 中间提交列表改为接近 IDEA 的日志浏览器
3. 顶部增加筛选条：分支、用户、日期、路径
4. 提交区展示真实 commit graph 与 merge 线
5. 右侧详情区改成更接近 IDEA 的信息密度
6. 右侧修改文件默认按目录树展示，并允许切换到平铺
7. 文件预览仍然使用弹窗 Diff，不做编辑器内联预览

## 目标

本次改版完成后，Git 日志面板应满足：

- 能按真实 Git 历史展示提交图，而不是普通时间线
- 能按筛选条件从后端重新查询，而不是只对当前已加载窗口做前端过滤
- 能在右侧以目录树方式浏览提交修改文件，适合大提交
- 保持现有 Git 预览、分支切换、分支比较、创建分支等能力不回退
- 风格与现有设置页、工作台、右侧面板保持统一，不引入另一套割裂样式

## 非目标

本次不做以下内容：

- 不实现完整 IDE 编辑器内联差异预览
- 不实现完整 blame、annotate、stash、interactive rebase 等高级 Git 能力
- 不实现完全等同 IDEA 的所有列定制、窗口停靠与多仓库日志聚合
- 不引入重型第三方 Git graph UI 组件作为核心依赖

## 参考实现结论

对 `D:\cursor_project\desktop-cc-gui` 的现有实现进行了核对，得到可参考结论：

- 它的 Git 历史数据结构已经包含 `parents` 与 `refs`
- 它的提交详情文件区已经有目录树辅助函数 `buildFileTreeItems`
- 它将日志页拆成数据、交互、视图与工具函数，结构较重

本仓库不直接照搬该实现，但参考两个方向：

1. 历史数据结构至少要包含 `parents` 与 `refs`
2. 右侧文件区可复用“按路径切分目录树”的轻量思路

## 现状与差距

### 现有接口

当前仅有以下日志相关接口：

- `GET /api/projects/:projectId/git/history?ref=&limit=`
- `GET /api/projects/:projectId/git/history/compare`
- `GET /api/projects/:projectId/git/history/commit`
- `GET /api/projects/:projectId/git/history/file`

其中 `/git/history` 当前只返回：

- `sha`
- `shortSha`
- `summary`
- `author`
- `commitTime`

它不包含：

- `parents`
- `refs`
- `authorEmail`
- `message`
- 可用于 graph 的拓扑信息

因此前端无法渲染真实 graph，也无法展示分支/标签徽标。

### 现有前端结构

当前 [GitHistoryPanel.tsx](/D:/cursor_project/codem/src/components/GitHistoryPanel.tsx) 是单文件实现，已经包含：

- 左侧分支树
- 中间提交列表
- 右侧详情与文件列表
- 分支菜单、创建分支弹窗、历史文件预览弹窗

这轮不能大规模重写成多模块架构，但可以适度拆 helper，把高复杂度逻辑从组件体内挪走。

## 设计决策

## 1. 历史接口升级为“日志浏览器接口”

保留现有 `/git/history/commit` 与 `/git/history/file`，用于右侧详情与弹窗预览。

新增接口：

- `GET /api/projects/:projectId/git/history/log`

查询参数：

- `refs`: 可重复参数，表示筛选分支/引用
- `authors`: 可重复参数，表示作者
- `dateFrom`: 起始日期，格式 `YYYY-MM-DD`
- `dateTo`: 截止日期，格式 `YYYY-MM-DD`
- `paths`: 可重复参数，表示路径前缀或具体文件
- `search`: 提交信息或 SHA 搜索
- `limit`: 本次返回数量，默认 `80`
- `cursor`: 下一页游标

返回结构新增为：

```ts
type GitHistoryGraphLaneSegment = {
  lane: number;
  kind: 'vertical' | 'start' | 'end' | 'merge-left' | 'merge-right';
};

type GitHistoryGraphRow = {
  lane: number;
  colorIndex: number;
  segmentsBefore: GitHistoryGraphLaneSegment[];
  segmentsAfter: GitHistoryGraphLaneSegment[];
};

type GitHistoryLogCommit = {
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

type GitHistoryLogResponse = {
  commits: GitHistoryLogCommit[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  availableAuthors: string[];
  activeRefs: string[];
};
```

决策原因：

- 中间列表需要真实拓扑，前端不能只靠 `sha + summary` 瞎推
- 作者筛选下拉可以直接复用当前窗口可选作者，避免额外查一次
- `cursor` 比 `offset` 更适合日志增量加载

## 2. graph 由后端计算，前端只渲染

graph 不在前端推导，统一由后端输出每一行的 lane 与线段信息。

后端将基于：

- `git log --date-order --decorate=short --parents`

读取当前窗口提交，并根据提交顺序维护一组活跃 lane：

- 当前提交所在 lane 作为圆点列
- 若有多个 parent，则在 `segmentsAfter` 里追加 merge 分叉
- 若一个 lane 在当前提交后结束，则输出 `end`
- 若新分支线在当前提交后出现，则输出 `start`

前端只做：

- 按 `graph.lane` 渲染圆点
- 按 `segmentsBefore/segmentsAfter` 画纵线和斜线
- 按 `colorIndex` 选择线色与节点色

决策原因：

- 真实 Git graph 的复杂度不适合塞进 React 组件里
- 后端更容易测试，也更接近数据源
- 前端渲染层保持纯展示，便于后续样式调整

## 3. 顶部改成纯工具栏，三栏支持拖拽分割

日志面板顶部不再保留“分支 / 提交历史 / 提交详情”这类纯文字标题栏，改为单行工具栏：

- 左侧放分支相关操作按钮
- 中间放日志筛选与刷新操作
- 右侧放详情区视图切换等按钮

设计要求：

- 工具栏本身承担操作入口，不再额外占一行展示纯标题文字
- 按钮、输入框、下拉高度与现有设置页工具条保持一致
- 工具栏背景、边框、hover、激活态全部复用现有主题变量

日志主体仍为三栏：

- 左侧分支树区
- 中间日志区
- 右侧详情区

左侧分支树区顶部增加搜索输入框，行为对齐 IDEA：

- placeholder 使用“分支或标签”
- 输入后只过滤左侧树节点，不触发中间日志接口重查
- 搜索范围包含本地分支、远程分支、标签与分组下子节点
- 无匹配项时显示空态，不破坏原有分组结构数据

三栏之间加入可拖拽分割线：

- 左右分割线均可水平拖拽
- 拖拽时实时调整相邻两栏宽度
- 三栏都设置最小宽度，避免拖到不可用
- 默认宽度沿用当前布局初始化
- 拖拽结果仅保留在当前面板会话内，本轮不做持久化

## 4. 中间提交区改成“筛选条 + 列表表格”

提交区结构调整为：

- 顶部筛选条
- 列头：`graph / 提交信息 / 作者 / 时间`
- 可滚动日志区

筛选条包含：

- 搜索框：搜索 `summary / message / sha`
- 分支下拉
- 用户下拉
- 日期范围
- 路径输入或下拉

交互规则：

- 修改筛选项后，重查 `/git/history/log`
- 滚动到底部时，如果 `hasMore = true`，追加下一页
- 选择提交后加载右侧详情

## 5. 右侧详情区默认目录树，可切平铺

右侧详情区保留三段式：

1. 提交元信息
2. 修改文件区
3. 补充信息区

其中修改文件区默认目录树展示，支持切换：

- `目录`
- `平铺`

默认值使用局部状态，不影响全局审查区设置。

目录树实现策略：

- 新增轻量 helper，把 `commitDetails.files` 转为树节点
- 节点只包含目录名、完整路径、展开状态、子节点、文件项
- 默认展开根级目录，深层目录按需展开

决策原因：

- 用户明确要求右侧详情区默认目录树
- 本仓库已有 review 区 `tree / flat` 展示语义，可复用命名和视觉
- 不需要把目录树交给后端，前端按路径切分即可

## 6. 弹窗预览链路保持不变

继续复用：

- `fetchGitCommitFilePreview`
- `MemoGitDiffViewer`
- `CodeSnapshotViewer`

仅在右侧详情区双击文件时打开弹窗。

决策原因：

- 用户已明确不做内联编辑器预览
- 当前弹窗预览已经具备 `diff / before / after`
- 避免本轮改动过多触碰 Diff 主链路

## 7. 左侧分支树继续沿用当前结构

左侧不再重构为新的日志导航，只保留当前已实现结构：

- `HEAD(当前分支)`
- `本地`
- `远程`
- `标签`
- `origin / upstream ...`

但交互语义调整为更接近 IDEA：

- `HEAD(当前分支)` 作为单独状态行展示当前检出分支信息
- `HEAD(当前分支)` 下方不再重复渲染一个当前分支子节点
- 当前分支仍会正常出现在 `本地` 分组里
- 点击 `HEAD(当前分支)` 时，行为等同于切回当前检出分支对应上下文
- 左侧顶部搜索框同时作用于 `HEAD / 本地 / 远程 / 标签`
- `标签` 作为单独分组展示，默认折叠
- 标签搜索命中时自动展开 `标签` 分组
- 中间筛选条中的分支筛选同时允许选择标签 ref

中间筛选条中的“分支”与左侧分支树互补：

- 左侧用于切换上下文和浏览分支
- 顶部筛选条用于日志查询条件

## 文件改动规划

预计主要改动文件如下：

### 后端

- [server/lib/workspace-store.ts](/D:/cursor_project/codem/server/lib/workspace-store.ts)
  - 新增日志接口数据读取
  - 新增 graph 计算
  - 扩展历史提交数据结构
- [server/index.ts](/D:/cursor_project/codem/server/index.ts)
  - 新增 `/git/history/log`
- [server/lib/workspace-store-git.test.ts](/D:/cursor_project/codem/server/lib/workspace-store-git.test.ts)
  - 新增日志筛选与 graph 相关测试

### 前端

- [src/types.ts](/D:/cursor_project/codem/src/types.ts)
  - 新增日志接口与 graph 类型
- [src/lib/git-api.ts](/D:/cursor_project/codem/src/lib/git-api.ts)
  - 新增 `fetchGitHistoryLog`
- [src/components/GitHistoryPanel.tsx](/D:/cursor_project/codem/src/components/GitHistoryPanel.tsx)
  - 提交区改版
  - 右侧详情区目录/平铺切换
- `src/lib/git-history-graph.ts`
  - graph 渲染辅助
- `src/lib/git-history-file-tree.ts`
  - 提交详情文件树构建辅助
- [src/styles.css](/D:/cursor_project/codem/src/styles.css)
  - Git 日志整体布局、拖拽分割线与 graph 样式

## 性能要求

本次改版必须满足以下性能边界：

- 首屏默认只拉取 `80` 条提交
- 滚动增量加载，不一次性拉全仓库
- 左侧分支树与右侧详情不要因为筛选变化而整体重建
- graph 只对当前窗口数据计算，不全量计算整个仓库
- 目录树展开状态本地维护，切换提交时按新文件集重算
- 拖拽分割线时只更新必要布局状态，不触发日志数据重查
- 拖拽过程优先使用轻量状态与 `requestAnimationFrame` 节流，避免大列表抖动

## 测试策略

### 后端单测

- 日志接口返回 `parents` 与 `refs`
- 多父提交能输出 merge 线段
- 分支筛选、作者筛选、日期筛选、路径筛选可组合使用
- `cursor` 能正确续页
- 顶部不再出现单独文字标题栏
- 左中右三栏分割线可拖拽，且最小宽度约束生效
- 左侧支持分支/标签搜索
- `HEAD(当前分支)` 不再重复挂一个当前分支子节点

### 前端单测

- graph helper 渲染输入映射正确
- 文件列表能正确构建目录树
- `目录 / 平铺` 切换不丢选择态

### 手工验证

- merge commit 显示真实分叉/合并
- 顶部筛选修改后日志刷新正确
- 右侧默认目录树展开正常
- 双击文件能继续打开弹窗 Diff
- Web 端与桌面端样式保持一致

## 风险

### 风险 1：graph 算法复杂度高

缓解方式：

- 首版仅覆盖当前窗口的可视拓扑
- 采用简化 lane 算法，不追求完整 GitKraken 级别细节
- 通过固定测试仓库覆盖 merge 场景

### 风险 2：单文件组件继续膨胀

缓解方式：

- 新增 graph helper 与 file tree helper
- 把重数据逻辑从 `GitHistoryPanel.tsx` 迁出

### 风险 3：筛选条与当前分支切换关系混乱

缓解方式：

- 左侧点击分支时同步更新“分支筛选”
- 用户手动改顶部筛选时，以顶部筛选为准
- UI 文案明确是“筛选”，不是“当前分支”

## 最终结论

本次 Git 日志改版采用：

- 左侧沿用当前分支树
- 左侧增加分支/标签搜索
- 顶部改成纯工具栏，不保留额外标题行
- 中间改为 IDEA 风格日志浏览器
- 后端新增日志接口并负责真实 graph 计算
- 右侧默认目录树展示文件，并支持平铺切换
- 左中右三栏之间支持拖拽调宽
- `HEAD(当前分支)` 仅作状态行展示，不重复渲染当前分支节点
- 左侧新增 `标签` 分组，结构对齐 IDEA
- 文件预览继续使用弹窗 Diff

这是当前需求、实现成本、后续可维护性三者之间最稳的方案。
