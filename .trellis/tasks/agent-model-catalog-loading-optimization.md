# Task: 优化新会话模型目录加载

## Background

Codex 等通用 Agent 的模型目录需要启动对应 CLI 并完成初始化。实测
`/api/agents/openai-codex/models` 单次约耗时 3.9 秒。当前前端只在
`useAgentRun` Hook 内保存目录，首次打开默认 Provider 的新会话仍会等待；
页面重载或 Hook 重建后也会重新探测，加载期间模型和思考级别会短暂回退。

## Objective

新建或切换 Agent 会话时立即复用已加载的模型目录，避免模型和思考级别短暂回退，并合并重复请求

## Scope

In scope:

- 前端共享模型目录缓存、同 Provider 并发请求合并和默认 Provider 后台预热。
- 已有目录的 stale-while-revalidate 展示，刷新时不清空当前模型控件。
- Rust 后端短 TTL 进程缓存，减少重复启动 Agent CLI。
- 手动重试显式绕过前后端缓存，并保留失败前的可用目录。
- 缓存隔离、过期、并发去重和强制刷新的自动化测试及浏览器回归。

Out of scope:

- 不将动态模型目录持久化到 SQLite 或配置文件。
- 不改变会话模型、思考级别和权限的持久化语义。
- 不复用正在运行的 Agent 进程查询模型目录。

## Impact

- Frontend: `useAgentRun` 模型目录加载状态和共享缓存 helper。
- Backend: `/api/agents/{provider_id}/models` 缓存与强制刷新参数。
- UX: 新建会话优先立即显示已知模型和对应思考级别。

## Acceptance Criteria

- [x] 默认通用 Agent Provider 在用户进入新会话前后台预热模型目录。
- [x] 同一 Provider 的并发读取只发起一次真实请求。
- [x] 缓存命中时新建/切换会话不清空模型和思考级别控件。
- [x] 缓存过期时保留旧目录并在后台刷新。
- [x] 手动重试绕过前后端缓存；刷新失败时旧目录仍可继续使用。
- [x] Provider 之间的目录、错误和加载状态互不串扰。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/agent-model-catalog-cache.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_model_catalog_cache`
- Playwright 连续新建会话、切换 Provider，并核对模型目录请求次数和控件状态。

## Implementation Record

- 2026-07-15T15:07:05.392Z 敏感信息扫描无命中；新增缓存 helper 与测试已按仓库规范暂存，未提交未推送。
- 2026-07-15T14:46:06.617Z 实测 Codex 模型目录接口首次调用约 3.9 秒；采用前端共享 TTL 缓存与默认 Provider 预热、后端进程 TTL 缓存，手动刷新显式绕过两层缓存。

- 2026-07-15T14:34:12.892Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T15:07:04.415Z `Playwright 模型探测回归`: 清空前端缓存后 Codex 模型目录请求 4ms，直接显示默认/Low；切换 Claude 后再切回 Codex 无新增请求，控制台 0 error。
- 2026-07-15T15:07:03.305Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过，lib 122 passed/1 ignored，desktop 9 passed。

- 2026-07-15T15:07:02.256Z `node --import tsx --test src/**/*.test.ts`: 通过，487/487。
- 2026-07-15T15:07:01.235Z `npm run typecheck`: 通过，TypeScript 无错误。

## Completion Summary
- 2026-07-15T15:07:40.127Z 完成 Agent 模型探测加载优化：默认 Provider 后台预热，前端共享 TTL 缓存与并发去重，后端短 TTL 缓存和强制刷新；浏览器首次缓存读取 4ms，重复切换 0 新请求。

## Follow-ups

- 无。
