# Task: Codex 原生上下文窗口

## Background

Composer 当前允许 Claude 与 Codex 展示上下文用量。Codex 运行时会通过 App Server 的 `thread/tokenUsage/updated` 事件返回真实 `modelContextWindow`，但首次运行前或旧历史缺少该字段时，前端仍需要一个固定回退值。API 模型上下文并不等于 Codex 产品的实际可用上下文；本机 Codex 模型缓存声明 272,000、有效比例 95%，当天多个真实会话均返回 258,400，因此首次运行前采用 258,400，运行时原生窗口继续优先覆盖。同时 Codex 不复用 Claude `窗口 - 45k` 的自动压缩阈值。

## Objective

Codex 首次运行前使用客户端实际有效窗口 258,400，运行时原生窗口优先覆盖，并移除 Claude 压缩阈值误判。

## Scope

In scope:

- Codex 缺少运行时 `modelContextWindow` 时使用 258,400 固定窗口。
- 收到运行时 `modelContextWindow` 后立即覆盖固定窗口。
- Codex 不再使用 Claude `窗口 - 45k` 的自动压缩提示；保留现有原生 `/compact` 能力入口。
- 补充聚焦测试，覆盖运行前固定窗口、运行后原生覆盖和 Claude 既有行为。

Out of scope:

- 不维护 Codex 模型上下文硬编码列表。
- 不修改 Claude、自定义渠道或其他 Agent 的上下文能力配置。
- 不修改 Codex App Server 事件协议、会话持久化结构和原生 compact 生命周期。

## Impact

- Frontend：`src/lib/composer-context-usage.ts`、上下文指示器及其聚焦测试。
- Backend：无协议或实现改动；继续消费现有 `modelContextWindow`。

## Acceptance Criteria

- [x] Codex 新会话在原生窗口尚未返回时按 258,400 计算，不出现“上限未知”。
- [x] 收到 Codex `modelContextWindow` 后显示真实分母、占用量和百分比。
- [x] Codex 上下文卡片不再宣称进入 Claude 自动压缩区间。
- [x] Claude 现有 200k、1M、原生 `/context` 和阈值行为保持不变。

## Verification Commands

- `node --import tsx --test src/lib/composer-context-usage.test.ts src/lib/codex-compact-ui.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-08-11T14:27:53.323Z 根据 Codex 客户端模型缓存与真实会话事件将默认有效窗口修正为 258,400；保留运行时 modelContextWindow 覆盖，撤回仅为百万 Token 展示增加的格式化改动，并同步修正测试、任务记录和经验记录。

- 2026-08-11T14:18:29.730Z 根据本机 Codex 客户端模型缓存与真实会话事件修正口径：GPT-5.6 Sol/Terra/Luna 的有效窗口为 258,400，Codex 首次运行前使用该固定值；运行时 modelContextWindow 仍优先覆盖，旧模型可返回自身窗口；移除上限未知状态。
- 2026-08-11T14:01:08.317Z Codex 上下文窗口改为仅信任运行时 modelContextWindow；未知时保留入口但显示上限未知；Codex 不再套用 Claude 窗口减 45k 的自动压缩阈值，原生 compact 操作保持不变。

- 2026-08-11T13:57:22.457Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T14:30:02.865Z `curl.exe -I http://127.0.0.1:5173/`: 通过，桌面开发模式 Vite 服务 HTTP 200，前端已由 HMR 加载

- 2026-08-11T14:30:01.894Z `git diff --check`: 通过
- 2026-08-11T14:30:01.028Z `npm run build`: 通过；仅有既有 Vite chunk/dynamic import 警告

- 2026-08-11T14:30:00.281Z `npm run typecheck`: 通过
- 2026-08-11T14:29:59.627Z `node --import tsx --test src/lib/composer-context-usage.test.ts src/lib/codex-compact-ui.test.ts`: 通过，15/15 tests passed；Codex 默认 258,400、8.4% 与运行时覆盖均已验证

- 2026-08-11T14:20:06.294Z `curl.exe -I http://127.0.0.1:5173/`: 通过，桌面开发模式 Vite 服务 HTTP 200，HMR 已加载前端调整
- 2026-08-11T14:19:25.732Z `git diff --check`: 通过

- 2026-08-11T14:19:24.968Z `npm run build`: 通过；仅保留现有 Vite chunk/dynamic import 警告
- 2026-08-11T14:19:24.306Z `npm run typecheck`: 通过

- 2026-08-11T14:19:23.659Z `node --import tsx --test src/lib/composer-context-usage.test.ts src/lib/codex-compact-ui.test.ts`: 通过，15/15 tests passed
- 2026-08-11T14:07:45.777Z `curl.exe -I http://127.0.0.1:5173/`: 通过，桌面开发模式的 Vite 服务返回 HTTP 200，前端改动已由 HMR 加载

- 2026-08-11T14:07:44.970Z `git diff --check`: 通过
- 2026-08-11T14:07:44.161Z `npm run build`: 通过；仅保留现有 Vite chunk/dynamic import 警告

- 2026-08-11T14:07:43.369Z `npm run typecheck`: 通过
- 2026-08-11T14:07:42.686Z `node --import tsx --test src/lib/composer-context-usage.test.ts src/lib/codex-compact-ui.test.ts`: 通过，15/15 tests passed

## Completion Summary
- 2026-08-11T14:30:20.089Z Codex 首次运行前上下文回退改为客户端实际有效窗口 258,400；运行时 modelContextWindow 继续优先覆盖，Codex 不复用 Claude 自动压缩阈值；修正测试、任务与经验记录，聚焦测试、typecheck、build、diff check 和开发服务健康检查均通过。

- 2026-08-11T14:20:06.977Z Codex 首次运行前上下文窗口改为 Codex 客户端实际有效值 258,400，不再出现上限未知；运行时 modelContextWindow 继续优先覆盖，Codex 不套用 Claude 自动压缩阈值。
- 2026-08-11T14:08:17.610Z 完成 Codex 原生上下文窗口闭环：未知窗口显示上限未知，运行时 modelContextWindow 到达后显示真实用量，移除 Codex 对 Claude 自动压缩阈值的复用并保留原生 compact 入口；聚焦测试、typecheck、build、diff check 和桌面开发服务健康检查均通过。

## Follow-ups

- 待补充。
