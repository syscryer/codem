# Task: 实现自动化中心

## Background

侧栏已经展示“自动化”入口，但按钮没有行为。CodeM 现有 Agent 运行链支持多个后台线程并发，线程与历史保存在本地 SQLite；缺少的是自动化配置、调度租约、运行索引和管理界面。

## Objective

参考 Codex 桌面端实现本地自动化创建、调度、运行与历史闭环

## Scope

In scope:

- 新增独立自动化页面，侧栏入口可打开并参与应用前进/后退导航。
- 支持创建、编辑、启用/停用、删除和立即运行自动化。
- 自动化配置包含名称、提示词、项目、Agent、渠道、模型、思考级别、权限和执行计划。
- 执行计划支持按分钟/小时、每天、工作日、每周和每月，按本机时区计算。
- Rust/SQLite 持久化自动化配置与最近运行记录，并用原子领取避免多窗口重复触发。
- 前端常驻低频调度到期任务，复用现有 Agent 运行链创建后台线程，不切换用户当前页面。
- 每次运行生成可打开的 Agent 会话；自动化页面展示运行状态、时间、错误和跳转入口。
- 运行完成、失败或等待审批时同步更新自动化运行记录；应用重启后配置与历史可恢复。
- 视觉复用 CodeM 主题 token、品牌图标、按钮、输入和列表交互。

Out of scope:

- 应用完全退出后继续调度，或通过系统服务/计划任务唤醒应用。
- 首版自动创建隔离 Git worktree；数据模型保留执行环境字段，先使用项目当前目录。
- 自动化运行中自动回答审批或 AI 提问；需要人工处理时明确显示等待状态。
- 支持任意原始 cron/RRULE 文本编辑器。

## Impact

- Frontend：新增自动化页面、API helper、调度 hook、导航类型与侧栏入口。
- Backend：新增 automation 独立 module、SQLite 表和 REST API。
- Existing runtime：为 Claude 与通用 Agent hook 增加指定后台线程启动入口；不改变现有聊天提交路径。
- Persistence：线程创建增加不激活选项，避免自动化切走用户当前会话。

## Acceptance Criteria

- [x] 自动化入口可打开，页面在浅色/深色和不同强调色下与 CodeM 风格一致。
- [x] 可完整创建、编辑、启停和删除自动化，刷新与重启后数据仍存在。
- [x] 支持间隔、每天、工作日、每周和每月计划，页面展示下次运行时间。
- [x] 到期任务在应用运行时自动领取，同一自动化不会因多个轮询重复执行。
- [x] 立即运行不改变原计划的下次运行时间。
- [x] 自动化在后台创建对应 Agent 会话，不切换当前项目、线程或页面。
- [x] Claude、Codex、Grok Build、OpenCode 使用各自现有运行机制；不可用时记录明确失败。
- [x] 完成、失败和等待人工处理状态可见，最近运行可跳转到完整会话。
- [x] 自动化轮询低频且无并发请求，不影响 Agent 流式输出和工作区交互。
- [x] 前端测试、Rust 自动化模块测试、类型检查和构建通过。

## Verification Commands

- `node --import tsx --test src/lib/automation-schedule.test.ts src/lib/automation-api.test.ts src/lib/automation-ui.test.ts`
- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml automation`
- `npm run build`
- `git diff --check`

## Implementation Record

- 2026-07-18T01:14:20.162Z 完成自动化 Rust 持久化、原子领取、后台 Agent 调度、管理页面、导航与终态映射；专项测试、Rust 测试和类型检查已通过，开始桌面验收。
- 2026-07-18 完成独立 Rust/SQLite 自动化模块、原子领取、后台线程契约、低频前端调度、自动化中心页面、导航和运行终态映射；Claude 启动通过同步 onStarted 确认，不阻塞长任务调度。
- 2026-07-17T18:18:14.756Z 确定自动化架构：Rust/SQLite 持久化配置与运行记录，前端低频领取到期任务并复用现有后台线程运行；创建后台线程时不改变当前页面和选择。

- 2026-07-17T18:08:39.989Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T01:32:58.827Z `typecheck、build、cargo fmt、diff check 与 Playwright 端到端验收`: 全部通过；自动化创建、持久化、立即运行、后台不切页、完成回写和历史回显均正常，测试数据已清理

- 2026-07-18T01:32:47.524Z `Rust 全量测试`: 168 passed, 0 failed, 1 ignored
- 2026-07-18T01:32:37.773Z `前端全量测试`: 560 passed, 0 failed

- 前端全量测试：560 passed，0 failed。
- Rust 全量测试：168 passed，0 failed，1 ignored。
- 自动化专项：前端 12 passed，Rust 3 passed。
- `npm run typecheck`、`npm run build`、`cargo fmt --check`、`git diff --check` 通过。
- Playwright 真实验收：创建停用配置、SQLite 回读、立即运行、后台会话不切页、完成状态回写与会话历史 `AUTOMATION_UI_OK` 均通过；测试数据已清理。

## Completion Summary
- 2026-07-18T01:33:09.554Z 完成自动化中心完整版：Rust/SQLite 配置与运行记录、原子领取、五类计划、低频调度、后台 Agent 会话、完整管理页面、运行历史与会话跳转；全量测试和真实端到端验收通过。

已完成 CodeM 自动化中心完整版：独立持久化、原子调度领取、后台 Agent 执行、五类计划、完整配置编辑、启停/删除/立即运行、运行历史和会话跳转，并保持普通聊天与现有 Agent 流程不变。

## Follow-ups

- 浏览器功能在自动化验收完成后作为独立 Trellis 任务推进。
