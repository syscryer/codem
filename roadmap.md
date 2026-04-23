# CodeM Roadmap

本文档用于记录 `CodeM` 后续要做的工作，方便多个会话并行接手，不必依赖聊天上下文回忆。

## 当前基线

当前仓库已经完成的基础能力：

- 本地 Web UI 调用 `Claude Code`
- stream-json 实时展示
- turn 级对话聚合
- Markdown / GFM 渲染
- 工具调用内联步骤展示
- 项目 / 线程导入与持久化
- SQLite 持久化
- 项目 / 线程基础菜单
- 一轮前端结构化重构
- 轻量 `.trellis` 和 `openspec` 骨架

## P0 核心可用性

这部分优先保证“每天能稳定用”，优先级最高。

- 修完运行态边界问题：
  - 停止后残留状态
  - 空回复
  - terminal event 缺失时的 turn 收尾
  - resume / stale transcript 恢复
- 把 header 里的 `用编辑器打开` 做成真实能力
- 把 header 里的 diff 数字接真实 git diff
- 给 `运行` / `提交` 按钮接最小可用闭环
- 再跑一轮完整链路验证：
  - 新增项目
  - 新建线程
  - 续聊
  - 停止
  - 删除线程
  - 刷新恢复

## P1 日常使用能力

- 完善线程菜单：
  - 归档聊天
  - 置顶聊天
  - 标记未读
  - 复制工作目录
  - 复制 deeplink
- 完善项目菜单：
  - 创建永久工作树
  - 更多工作区相关动作
- 做设置页，至少承载：
  - provider 配置
  - 默认权限
  - 默认模型
  - 工作目录 / 编辑器配置
- 完善搜索和筛选体验
- 把布局按钮接成真实切换能力

## P1 Provider / 模型体系

- 抽象 provider 体系，而不是只围绕 Claude 路径扩展
- 后续目标 provider：
  - Claude Code
  - Codex
  - Gemini
- 统一 provider / model / session / workspace 数据模型
- 处理 provider 切换后的会话延续规则
- 处理多窗口 / 刷新后的 provider-model 同步

## P1 Backend 工程化

- 继续拆 `server/index.ts`
- 建议演进方向：
  - `routes/`
  - `services/`
  - `storage/`
  - `lib/`
- 抽离核心职责：
  - workspace bootstrap
  - project/thread CRUD
  - Claude bridge
  - git diff / status
  - system integration

## P1 测试和质量

- 给关键流程补测试：
  - thread create/delete
  - history persist/restore
  - session resume fallback
  - stream terminal event handling
- 至少补一层 smoke / hook / service 测试
- 除 `npm run typecheck` 外，补充更可靠的验证路径

## P2 体验补齐

- 顶部更多按钮菜单
- mini window / 派生工作树 / 派生到本地
- 更完整的项目区排序 / 显示策略
- 更细的工具步骤展示
- 更接近 Claude Code TUI / Codex Desktop 的事件与统计展示

## P2 规范和流程

- 继续补 `.trellis`：
  - `.trellis/scripts/`
  - developer init
  - session record
- 真正开始使用 `openspec`：
  - provider 适配 proposal
  - workspace 行为 proposal
  - session / thread 生命周期 proposal

## 推荐接手顺序

建议别的会话按下面顺序继续：

1. `用编辑器打开` + 真实 git diff
2. `运行` / `提交` 最小闭环
3. backend service 分层
4. provider 抽象
5. 设置页
6. 线程 / 项目高级菜单
7. 测试补齐
8. `.trellis` / `openspec` 流程增强

## 备注

- 结构重构已经做过一轮，不建议再把大量逻辑塞回 `App.tsx`
- `.idea/` 应忽略，不应提交
- 当前 `.trellis` 是轻量版，不要误以为已经具备完整自动化流程
