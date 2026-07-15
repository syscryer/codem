# Task: 发布 v0.1.10 并补充 MIT 协议

## Background

`v0.1.9` 之后已完成长任务界面性能优化、审查文件回滚修复，以及 Node 版会话列表加载失败的防护修复。本次发布同时补齐公开下载入口和仓库开源协议。

## Objective

发布包含会话列表加载修复的 v0.1.10，更新 README 下载说明并加入 MIT License

## Scope

In scope:

- 发布版本统一升级到 `0.1.10`。
- 纳入已完成并验证的 Node 版会话列表加载修复。
- README 增加最新 Release 下载入口与安装包选择说明。
- 新增标准 MIT License，并同步 npm 与 Cargo 许可元数据。

Out of scope:

- 不提交本机 `.mcp.json` 配置。
- 不提交未被 README 或产品代码引用的临时图片。
- 不调整现有自动更新签名密钥与发布矩阵。

## Impact

- 发布元数据：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 文档与协议：`README.md`、`LICENSE`。
- 运行修复：workspace bootstrap、Claude transcript 导入、Git 摘要读取与前端错误提示。

## Acceptance Criteria

- [ ] 所有版本元数据一致为 `0.1.10`。
- [ ] README 可直达最新 GitHub Release，并说明 with-node/no-node 差异。
- [ ] 根目录存在标准 MIT License，npm/Cargo 元数据声明 MIT。
- [ ] workspace-store 回归测试、typecheck 和 package doctor 通过。
- [ ] GitHub Release workflow 完成并生成 `latest.json`、签名和各平台安装包。

## Verification Commands

- `node --test --import tsx server/lib/workspace-store-projects.test.ts`
- `node --test --import tsx server/lib/workspace-store-git.test.ts`
- `npm run typecheck`
- `npm run package:doctor`
- `git diff --check`

## Implementation Record

- 2026-07-15T06:15:07.907Z 确认 GitHub origin/main 为唯一发布基线；已将长任务性能修复、Node 会话列表修复和 v0.1.10 发布提交 rebase 到 origin/main@4f207b0，并在 ConversationPane 冲突中同时保留普通聊天回调与 previousTurns 性能优化。
- 2026-07-15T06:08:48.638Z 已将版本统一升级到 0.1.10；README 增加最新 Release 下载入口与 with-node/no-node 选择说明；新增标准 MIT LICENSE，并同步 npm/Cargo license 元数据；明确排除本机 .mcp.json 与未引用临时图片。

- 2026-07-15T06:07:06.558Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T06:16:13.449Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。
- 2026-07-15T06:16:12.740Z `npm run package:doctor`: 通过：发布环境检查 Doctor: OK。

- 2026-07-15T06:16:11.973Z `npm run typecheck`: 通过：rebase 到 GitHub main 后 TypeScript 类型检查无错误。
- 2026-07-15T06:16:11.258Z `node --test --import tsx src/hooks/useWorkspaceState.log-batching.test.ts`: 通过：日志批处理回归测试通过。

- 2026-07-15T06:16:10.558Z `node --test --import tsx src/components/ConversationPane.render-perf.test.ts`: 通过：3 项渲染性能测试通过，包含仅为可撤销 turn 构造 previousTurns。
- 2026-07-15T06:16:09.808Z `node --test --import tsx server/lib/workspace-store-git.test.ts`: 通过：16 项 Git/workspace-store 回归测试全部通过。

- 2026-07-15T06:16:09.040Z `node --test --import tsx server/lib/workspace-store-projects.test.ts`: 通过：4 项 projects/bootstrap 回归测试全部通过。
- 2026-07-15T06:10:04.340Z `git diff --check`: 通过：无 whitespace 错误，仅有 Windows LF/CRLF 提示。

- 2026-07-15T06:10:03.407Z `npm run package:doctor`: 通过：发布环境检查 Doctor: OK。
- 2026-07-15T06:10:02.527Z `npm run typecheck`: 通过：TypeScript 类型检查无错误。

- 2026-07-15T06:10:01.597Z `node --test --import tsx server/lib/workspace-store-git.test.ts`: 通过：16 个 Git/workspace-store 回归测试全部通过。
- 2026-07-15T06:10:00.686Z `node --test --import tsx server/lib/workspace-store-projects.test.ts`: 通过：4 个 projects/bootstrap 回归测试全部通过，包含异常 cwd 跳过导入用例。

## Completion Summary

- 2026-07-15T06:16:33.568Z 以 GitHub origin/main@4f207b0 为基线完成 rebase 与冲突合并；保留普通聊天交互和长任务渲染优化；rebase 后 workspace、Git、性能、日志批处理、typecheck 与 package doctor 验证全部通过。
- 2026-07-15T06:10:17.052Z 完成 v0.1.10 发布准备：纳入 Node 版会话列表加载修复，统一版本元数据，README 增加下载说明，新增 MIT License 并同步 npm/Cargo 许可声明；发布前回归测试、类型检查和 doctor 均通过。

## Follow-ups

- 无。
