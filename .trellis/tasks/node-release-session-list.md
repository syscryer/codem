# Task: 修复 Node 版 0.1.9 发布包会话列表加载失败

## Background

用户反馈发给用户的 Node 版 0.1.9 release 包从 0.1.8 升级后无法加载会话列表。本机开发环境无法直接复现，版本差异显示 0.1.9 没有直接改 workspace bootstrap 主链路，因此重点按 release 用户环境中的旧数据、坏 transcript、不可访问目录或 Git 状态读取异常处理。

## Objective

定位并修复用户从 0.1.8 升级到 Node 版 0.1.9 后会话列表无法加载的问题

## Scope

In scope:

- 排查 `v0.1.8..v0.1.9` 对 workspace bootstrap、release 打包和前端初始加载的影响。
- 增强 `/api/workspace/bootstrap`、Claude transcript 导入和启动时 Git 状态读取的局部容错。
- 增加回归验证，确保异常项目路径或外部 session 数据不会拖崩整个会话列表。

Out of scope:

- 不修改现有 SQLite schema。
- 不在没有用户日志的情况下删除或迁移用户数据。
- 不处理 Rust 后端分支问题，本次限定 Node 版 release 主线。

## Impact

- 后端：`server/lib/workspace-store.ts` 的 bootstrap、Claude session 导入和 Git 摘要读取。
- API：`server/index.ts` 的 bootstrap 错误响应。
- 前端：`src/hooks/useWorkspaceState.ts` 的初始加载失败提示。

## Acceptance Criteria

- [ ] 单个坏 Claude transcript 或不可访问 Claude project 目录不会导致整个会话列表加载失败。
- [ ] 启动时 active project 的 Git 状态读取异常不会导致 bootstrap 失败。
- [ ] `/api/workspace/bootstrap` 失败时后端日志和前端提示能给出明确原因。
- [ ] 现有 workspace-store 相关回归测试通过。

## Verification Commands

- `node --test --import tsx server/lib/workspace-store-projects.test.ts`
- `node --test --import tsx server/lib/workspace-store-git.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-07-06T04:37:56.900Z 确认 Node 版 0.1.9 release 问题限定在 workspace bootstrap 初始加载；已增加 Claude transcript 导入局部容错、active project Git 摘要容错、bootstrap API 错误日志和前端最终失败提示。

- 2026-07-06T04:27:16.821Z Task created by Trellis automation.
- 2026-07-06T04:57:00.000Z 对比 v0.1.8..v0.1.9 后确认 bootstrap 主链路没有直接版本差异；风险集中在 release 用户环境中的 transcript/Git/旧数据异常未被局部隔离。

## Verification Results
- 2026-07-06T04:39:03.284Z `npm run typecheck`: 通过：TypeScript 项目检查无错误。

- 2026-07-06T04:39:03.269Z `node --test --import tsx server/lib/workspace-store-projects.test.ts`: 通过：4 个 projects/bootstrap 回归测试全部通过，包含 cwd 指向非目录时跳过导入的新增用例。
- 2026-07-06T04:39:03.267Z `node --test --import tsx server/lib/workspace-store-git.test.ts`: 通过：16 个 Git/workspace-store 回归测试全部通过。

## Completion Summary
- 2026-07-06T04:39:38.751Z 完成 Node 版 release 会话列表加载失败的防护修复：bootstrap 不再被单个 Claude transcript、异常 cwd 或启动 Git 摘要读取拖崩；API 返回明确错误，前端最终失败时显示 toast；相关 workspace-store 测试和 typecheck 已通过。

## Follow-ups

- 待补充。
