# Task: Agent 安装更新与版本感知

## Background

当前 Agent 设置页已经支持 Claude Code、Codex、Grok Build 和 OpenCode 的本机探测与白名单安装，但用户只能看到“可用/未安装”等粗粒度状态，无法明确知道当前版本、最新版本和是否存在更新。页面仍保留实验性 Agent 开关，与这些 Agent 已转为正式功能的产品状态不一致。

## Objective

将 Agent 与模型统一为 Agent 设置，移除实验开关，提供当前版本、最新版本、可更新提示及国内镜像网络失败重试

## Scope

In scope:

- 设置导航、页标题和现行文档中的“Agent 与模型”改为“Agent 设置”。
- 删除实验性 Agent 开关、持久化写入和正式功能不再需要的提示文案。
- 后端诊断返回当前版本、最新版本、可更新状态和版本查询错误摘要。
- npm 类 Agent 在官方源安装/更新发生网络或下载失败时，使用可信国内镜像重试。
- 安装和更新操作继续使用后端 Provider 白名单；完成后重新探测并刷新界面。
- UI 明确展示未安装、已安装、可更新、操作中、成功和失败状态。

Out of scope:

- 普通聊天供应商、模型和 API Key 管理。
- Agent 凭据读取、登录或账号管理。
- 任意第三方镜像、任意前端命令执行和自动静默升级。
- 新增 Agent Provider。

## Impact

- Frontend: 设置导航、Agent Provider 管理组件、设置状态类型与回归测试。
- Backend: Agent 诊断、版本查询、白名单安装/更新和镜像重试策略。
- Docs: README 中 Agent 设置名称和正式功能说明。

## Acceptance Criteria

- [x] 设置导航和页面标题统一显示“Agent 设置”。
- [x] 页面不再出现实验性 Agent 开关或要求开启实验功能的文案。
- [x] 已安装 Agent 显示当前版本；能够查询时显示最新版本。
- [x] 当前版本低于最新版本时明确显示“可更新”并提供更新按钮。
- [x] 未安装 Agent 明确显示“未安装”、最新可安装版本和安装按钮。
- [x] 安装/更新完成后自动重新探测，页面展示新的版本和成功反馈。
- [x] npm 官方源发生网络/下载失败时可切换到可信国内镜像重试，其他错误保持原始失败。
- [x] 现有四类 Agent 的安装/更新命令仍由后端白名单决定。
- [x] 桌面宽屏和 900px 窄窗下版本信息与按钮无溢出、遮挡或错位。

## Verification Commands

- `npm run typecheck`
- 前端全量 TypeScript 测试入口
- Agent 管理定向 Rust 测试
- `cargo fmt --check`
- `cargo check --bin codem-backend`
- Playwright 宽屏与 900px 真实浏览器验收

## Implementation Record

- 2026-07-16T04:46:10.166Z 完成 Agent 设置正式化：移除实验门禁，增加版本感知、条件安装更新动作、来源感知更新和 npm 网络失败国内镜像重试；真实 UI 修正加载期误报与 Grok 错误上下文。
- 2026-07-16 完成正式化与生命周期实现：移除前后端实验开关和门禁，统一名称为“Agent 设置”；诊断新增当前/最新版本、可更新与查询错误；安装更新保留来源感知和 Provider 白名单，npm/pnpm/bun 仅在严格网络失败时使用 `registry.npmmirror.com` 重试；操作完成后强制刷新命令缓存、诊断与对应 Agent probe。
- 2026-07-16 完成紧凑版本状态带：加载期先使用 Provider Registry 判断已安装状态，稳定后展示未安装、已安装、已是最新或可更新；只在未安装或可更新时显示主动作，镜像成功与版本未变化均有明确反馈。
- 2026-07-16T03:59:22.128Z 完成 CC Switch 与现有 Agent 生命周期实现对照：复用白名单和安装来源识别，新增远程版本、更新状态、升级后校验与 npm 网络失败镜像重试；正式 Agent 需移除前后端全部实验门禁。

- 2026-07-16T03:54:58.489Z Task created by Trellis automation.

## Verification Results

- 2026-07-16T04:46:12.643Z `Playwright 1440x1000 与 900x900 Agent 设置验收`: 通过：加载期已安装状态正确，Claude/Codex/OpenCode 可更新版本正确，Grok 官方更新器限制有中文上下文，无溢出遮挡；稳定刷新控制台 0 error/0 warning。
- 2026-07-16T04:46:11.817Z `node --import tsx --test src/**/*.test.ts；npm run typecheck；cargo fmt --manifest-path src-tauri/Cargo.toml --check；cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend；git diff --check`: 通过：前端 494/494，TypeScript、Rust 格式、backend 编译和差异检查均通过，仅既有未使用函数告警与 Windows 行尾提示。

- 2026-07-16T04:46:10.978Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 135/135，1 个真实 Grok smoke 按设计忽略；桌面 main 9/9。
- `cargo test --manifest-path src-tauri/Cargo.toml`: 通过，Rust lib 135/135，1 个需真实 Grok 登录的 smoke 按设计忽略；桌面 main 9/9。
- `node --import tsx --test src/**/*.test.ts`: 通过，494/494。
- `npm run typecheck`: 通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`: 通过，仅保留仓库既有未使用函数告警。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。
- `git diff --check`: 通过，仅 Windows LF/CRLF 提示。
- 真实后端诊断：Claude `2.1.207 -> 2.1.211`、Codex `0.144.1 -> 0.144.5`、OpenCode `1.17.7 -> 1.18.2` 均正确显示可更新；Grok 当前 `0.2.99`，官方更新器错误有明确上下文。
- Playwright 1440x1000 与 900x900 验收通过：加载态、版本状态带和动作按钮无溢出或错位；稳定刷新后控制台 0 error/0 warning。

## Completion Summary

- 2026-07-16T04:46:29.309Z 完成 Agent 设置正式化与生命周期版本感知：移除实验开关和门禁，新增当前/最新版本与可更新状态、一键安装更新、来源感知更新、严格网络失败国内镜像重试和操作后复探；Rust/前端全量门禁及宽屏/900px 真实验收通过。
Agent 设置已作为正式功能开放，具备安装状态、当前/最新版本、可更新提示、一键安装/更新、来源感知更新、国内镜像网络失败重试和操作后复探。普通聊天机制与 Agent 凭据边界未改变。

## Follow-ups

- Grok Build 使用官方 `grok update --check --json`；本机返回 `program not found` 时只展示真实限制，不猜测最新版本，也不改走 npm 或第三方源。
