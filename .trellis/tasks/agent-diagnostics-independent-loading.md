# Task: Agent 版本独立异步探测

## Background

Agent 设置页当前把本机 CLI 诊断和远程版本查询绑定在同一接口中，前端又等待四个 Agent 的请求全部结束后统一落状态。任一 npm registry 或 Agent 更新器响应较慢时，整个详情区域都会持续加载；瞬时查询失败还会让 Codex 显示“最新版本暂不可查询”。版本键值使用拉伸布局，标签和值之间距离过大。

## Objective

让每个 Agent 的本地状态与最新版本独立异步加载，修复 Codex 最新版本偶发不可查询并收紧版本布局

## Scope

In scope:

- 拆分本机 Agent 诊断与远程最新版本查询。
- 每个 Agent 独立异步加载并即时更新自身状态。
- 单项远程查询失败时保留该 Agent 上一次成功版本，不阻塞列表和其他详情。
- 参考 CC Switch 的 npm `dist-tags` 查询方式和紧凑版本展示。
- 补充前后端契约与渐进加载回归测试。

Out of scope:

- 不调整 Agent 渠道、模型、运行机制和普通聊天供应商。
- 不改变安装或更新命令本身。
- 不引入跨会话持久化的远程版本缓存。

## Impact

- Frontend: `AgentProviderSettings` 的加载状态、Agent registry API helper、版本展示样式。
- Backend: Agent 设置诊断接口与独立最新版本接口。
- Contract: 新增最新版本查询响应类型，保留现有诊断字段兼容。

## Acceptance Criteria

- [x] 打开 Agent 设置后列表和详情骨架不等待远程 registry 请求。
- [x] 四个 Agent 分别显示加载状态，任一项慢或失败不影响其他项更新。
- [x] Codex 可通过 npm 官方源或国内镜像查询 `@openai/codex` 最新版本。
- [x] 刷新失败时保留该 Agent 上一次成功的 latestVersion，并显示该项错误。
- [x] 当前版本和最新版本采用紧凑布局，不再用 `space-between` 拉开。
- [x] 安装或更新后，本地状态和远程版本分别重新刷新。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_latest_version`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`
- `git diff --check`

## Implementation Record

- 2026-07-16T06:12:16.491Z 完成真实根因修复：npm 版本查询改用轻量 dist-tags endpoint；本机诊断与最新版本拆分；每个 Agent 独立 AbortController、加载和错误状态；失败保留上一成功版本；版本布局改为紧凑键值行。
- 2026-07-16T05:54:04.916Z 已拆分本机诊断与远程最新版本接口，前端改为每个 Agent 独立请求控制器和渐进状态；Codex npm 实测 latest 为 0.144.5。运行态发现当前 3001 对本地 Codex 诊断请求超过 15 秒未返回，继续排查 CLI 探测超时。

- 2026-07-16T05:44:35.988Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T06:12:19.119Z `Playwright 1440x1000、900x900 与真实 Codex API`: 本地 0.144.1、latest 0.144.5；单项加载不阻塞切换；干净浏览器 0 console errors

- 2026-07-16T06:12:18.264Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust library 135 通过、1 ignored；桌面壳 9/9 通过
- 2026-07-16T06:12:17.373Z `npm run typecheck && node --import tsx --test src/**/*.test.ts`: 类型检查通过，前端 496/496 通过

- `npm run typecheck`：通过。
- `node --import tsx --test "src/**/*.test.ts"`：496/496 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：Rust library 135 通过、1 个真实 Grok smoke test 按预期忽略；桌面壳 9/9 通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend`：通过，仅有 2 个既存 dead_code warning。
- `git diff --check`：通过，仅输出工作区既有 LF/CRLF 提示。
- 真实 API：Codex 本地 `0.144.1`，npm latest `0.144.5`，轻量 dist-tags 查询约 1.29 秒。
- Playwright：1440x1000 与 900x900 页面检查通过；Claude 单项查询中可立即切换 Codex；干净会话 0 console errors。

## Completion Summary
- 2026-07-16T06:12:33.020Z Agent 版本探测已拆成逐项异步流程，Codex npm 查询改用轻量 dist-tags 并实测返回 0.144.5；版本布局收紧，失败保留旧结果，本机命令探测增加超时。

- 本机诊断和远程最新版本拆成独立接口，npm 查询改用轻量 `dist-tags` endpoint，避免下载 Codex 超过 10 MB 的完整包元数据。
- 每个 Agent 使用独立请求控制器和加载/错误状态，结果逐项落地；刷新失败保留上一份成功版本。
- 本机命令定位与 `--version` 增加 3 秒超时，避免异常 CLI 长时间占用请求。
- 当前/最新版本改为紧凑键值布局，查询状态仅显示在对应版本项。

## Completion Summary

## Follow-ups

- 暂无。
