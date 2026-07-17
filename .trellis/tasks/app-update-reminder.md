# Task: 补全应用更新提醒

## Background

CodeM 已具备 Tauri updater 检查、下载、安装和重启能力，但自动检查只在“基础设置”页面挂载时执行。用户正常启动并停留在工作区时看不到新版本提醒，容易长期停留在旧版本。

## Objective

在桌面安装版启动时异步检查更新，并提供非阻塞的全局更新提醒入口

## Scope

In scope:

- 应用设置加载完成后，根据“自动检查更新”开关异步检查一次更新。
- 首次检查完成后每 2 小时静默检查一次；使用单个延迟计时器，检测完成后再安排下一次，避免并发和高频轮询。
- 关闭自动检查时立即清理计时器；已有更新、正在下载、等待安装或正在安装时跳过网络请求。
- 发现新版本后在标题栏右侧显示持续、非阻塞的“更新”胶囊，颜色跟随 CodeM 主题 token。
- 只有用户点击“更新”后才在后台下载，下载期间不阻塞工作区；下载完成后再次提示安装并重启。
- 鼠标移入胶囊时展开 Release 更新日志卡片，长内容在卡片内滚动。
- 点击胶囊或日志卡片中的更新按钮可触发下载或安装，并展示实时进度。
- 更新失败时保留错误状态，允许重新检查并重试。
- 保留基础设置页现有的手动检查与安装入口。

Out of scope:

- 不改变 GitHub Release、`latest.json` 和签名生成流程。
- 不为 Web 版、开发模式或绿色版增加自动安装能力。
- 不后台自动下载或在未经用户点击时重启应用。

## Impact

- Frontend：应用启动状态、全局浮层、更新提示样式与更新回归测试。
- Backend / persistence：无改动，继续复用现有 Tauri updater 和基础设置持久化。

## Acceptance Criteria

- [x] 设置加载完成且启用自动检查时，应用启动只异步检查一次更新。
- [x] 首次检查后每 2 小时静默检查一次，检测请求不会并发重叠。
- [x] 关闭自动检查或组件卸载时清理计时器，已有待处理更新时不重复请求。
- [x] 检查失败静默处理，不阻塞工作区和 Agent 任务。
- [x] 自动检查只发现并提示版本，不会在用户操作前下载更新包。
- [x] 用户点击“更新”后异步下载，下载期间应用其他功能保持可用。
- [x] 下载完成后明确提示“安装并重启”，不会未经确认直接安装或重启。
- [x] 更新胶囊和操作按钮使用 CodeM 主题 token，不写死品牌色。
- [x] 鼠标移入胶囊后展示版本号和 Release 更新说明，长内容可在卡片内滚动查看。
- [x] 点击胶囊或卡片操作按钮可按当前阶段下载或安装，标题栏与卡片同步展示进度。
- [x] 更新失败后显示错误信息，并可重新检查后重试。
- [x] Web、开发模式、绿色版沿用现有限制，不展示不可执行的标题栏入口。
- [x] 基础设置页原有的立即检查、安装和自动检查开关不受影响。

## Verification Commands

- `node --import tsx --test src/lib/settings-api.test.ts`
- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record

- 2026-07-17T16:00:27.617Z 增加低开销定时更新检查：使用单个递归 setTimeout，每次检测完成后等待2小时；关闭开关或卸载时清理；已有更新流程时跳过请求，并保护定时结果不覆盖用户触发的下载状态。
- 2026-07-17T15:49:00.850Z 实现标题栏更新胶囊与悬浮 Release 日志卡片；更新流程拆为用户点击后后台下载、下载完成后二次提示安装重启，所有颜色跟随 CodeM 主题 token。

- 2026-07-17T15:29:15.569Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T16:01:04.228Z `git diff --check`: 通过，无空白错误；敏感信息扫描无命中。

- 2026-07-17T16:00:29.848Z `npm run build`: 通过；包含 TypeScript 检查和 Vite 生产构建，仅有既有 chunk/import 提示。
- 2026-07-17T16:00:29.112Z `node --import tsx --test src/**/*.test.ts`: 537/537 通过。

- 2026-07-17T16:00:28.398Z `node --import tsx --test src/lib/settings-api.test.ts src/lib/settings-runtime.test.ts`: 13/13 通过；验证2小时常量、单个 setTimeout、清理、跳过活动更新和两阶段下载安装。
- 2026-07-17T15:50:59.996Z `git diff --check`: 通过，无空白错误。

- 2026-07-17T15:50:59.288Z `npm run build`: 通过，Vite 生产构建完成；仅有既有 chunk/import 提示。
- 2026-07-17T15:50:58.488Z `npm run typecheck`: 通过，无 TypeScript 错误。

- 2026-07-17T15:50:57.769Z `node --import tsx --test src/**/*.test.ts`: 537/537 通过。
- 2026-07-17T15:50:57.100Z `node --import tsx --test src/lib/settings-api.test.ts src/lib/settings-runtime.test.ts`: 13/13 通过；覆盖自动检查、用户触发下载、下载完成停留、二次安装提示。

## Completion Summary

- 2026-07-17T16:01:04.919Z 在现有更新提醒基础上增加低开销的2小时周期检测：仅保留一个递归 setTimeout，检测完成后再计时；关闭自动检查或卸载时清理；已有更新、下载或安装状态时跳过网络请求；定时结果不会覆盖用户触发的下载。537个测试和生产构建通过。
- 2026-07-17T15:52:17.360Z 补全应用全局更新提醒：启动仅检查版本；标题栏使用主题 token 显示更新胶囊；悬浮展示 Release 日期和 Markdown 更新日志；用户点击后后台下载，下载完成后二次提示安装并重启；失败可重新检查重试。全量 537 个前端测试、typecheck、生产构建和 diff 检查均通过。

## Follow-ups

- 下一次发布产生高于当前版本的 `latest.json` 后，在安装版中手工走一遍真实下载、安装和重启链路。
