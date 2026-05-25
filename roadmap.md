# CodeM Roadmap

本文档用于记录 `CodeM` 后续要做的工作，方便多个会话并行接手，不必依赖聊天上下文回忆。

## 当前基线

当前仓库已经完成的基础能力：

- 本地 Web UI / Tauri 桌面壳调用 `Claude Code`
- stream-json 实时展示
- turn 级对话聚合
- Markdown / GFM 渲染
- 工具调用内联步骤展示
- 项目 / 线程导入与持久化
- SQLite 持久化
- 项目 / 线程基础菜单
- 权限菜单三档收敛：默认、自动执行、完全访问
- 模型选择与非运行线程 provider 配置刷新
- Effort 思考级别控制和 1M 长上下文开关
- Plan 确认、权限审批、AI 提问卡片
- `stdin + stream-json` 热会话复用，以及人工输入节点的冷恢复策略
- `TodoWrite` 计划卡片和输入框上方当前任务固定展示
- 运行中后续 prompt 队列和队列项删除
- 运行中 token 估算平滑展示、Claude 重试状态展示
- 设置页（12 个子页面）：基础、外观、模型、打开方式、快捷键、全局 Prompt、MCP、插件、Skills、用量统计、工作树、会话管理
- 右侧工作台：概览、文件树（懒加载+代码预览）、审查（Git 变更+Diff 预览+提交）、浏览器占位
- Git 历史面板：三栏布局、分支树、Git Graph SVG 连线、提交搜索/筛选、Diff 预览、分支比较
- Git 操作对话框：提交、推送、创建分支
- Terminal Dock：xterm.js 多标签终端（桌面版）
- Worktree 创建和管理
- Clone Repository 对话框
- Composer 图片附件
- MCP 多来源 Inspector（9 种来源读取）
- Slash Commands 系统（按来源分组）
- Usage 统计面板（趋势图、按提供商/模型/项目分组）
- 全局 Tooltip 层
- 窗口状态归一化（多显示器适配）
- 一轮前端结构化重构
- 轻量 `.trellis` 和 `openspec` 骨架

## P0 核心可用性

- 继续收敛运行态边界问题：
  - 停止后残留状态
  - terminal event 缺失时的 turn 收尾
  - resume / stale transcript 恢复
  - Plan / 审批 / AI 提问暂停后的冷恢复一致性
  - 运行队列与线程切换的边界验证

## P1 日常使用能力

- 完善线程菜单：
  - 归档聊天
  - 置顶聊天
  - 标记未读
  - 复制工作目录
  - 复制 deeplink
- 完善搜索和筛选体验
- 把布局按钮接成真实切换能力
- Right Workbench 浏览器 Tab 真实能力

## P1 Provider / 模型体系

- 抽象 provider 体系，而不是只围绕 Claude 路径扩展
- 后续目标 provider：
  - Claude Code
  - Codex
  - Gemini
- 统一 provider / model / session / workspace 数据模型
- 处理 provider 切换后的会话延续规则
- 处理多窗口 / 刷新后的 provider-model 同步
- 明确热会话运行中不切换 provider、运行结束后再同步配置的产品规则
- 评估 Claude Code 如果提供原生 stdin 审批协议后，是否可以减少 Plan / 审批节点的冷恢复成本

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
  - Plan approval 暂停与恢复
  - 权限拦截转审批卡片
  - queued prompt 删除
  - 当前任务固定卡片完成后收起
- 至少补一层 smoke / hook / service 测试
- 除 `npm run typecheck` 外，补充更可靠的验证路径

## P2 体验补齐

- 顶部更多按钮菜单
- mini window / 派生到本地
- 更完整的项目区排序 / 显示策略
- 更细的工具步骤展示
- 更完整的任务卡片交互，例如展开、跳转到原始 turn、历史任务查看
- 全局快捷键唤起（桌面版）
- 对话导出（Markdown / PDF）
- 全局对话全文搜索（SQLite FTS5）
- Prompt 模板 / 片段
- 运行完成系统通知

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

1. 后端重复代码提取（`claude-parsers.ts` 共享模块）
2. 运行态边界收敛
3. backend service 分层
4. 线程高级菜单（置顶 / 归档 / 标记未读，需先加数据库字段）
5. 全局快捷键 + 运行完成通知（改动小、体验提升大）
6. 全局对话全文搜索
7. provider 抽象
8. 测试补齐
9. `.trellis` / `openspec` 流程增强

## 备注

- 结构重构已经做过一轮，不建议再把大量逻辑塞回 `App.tsx`
- `.idea/` 应忽略，不应提交
- 当前 `.trellis` 是轻量版，不要误以为已经具备完整自动化流程
