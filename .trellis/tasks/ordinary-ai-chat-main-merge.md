# Task: 普通聊天合并主线

## Background

普通 AI 聊天已在独立 worktree 完成并通过验证，主工作区同时完成了多 Agent 原生设置。两个 worktree 共享同一基线提交，但改动尚未提交，且存在多个重叠文件，需要先分离提交再安全合并。

## Objective

将已验证的普通 AI 聊天改动与主工作区多 Agent 设置改动安全合并到 main

## Scope

In scope:

- 在 `codex/ordinary-chat` 形成普通聊天独立提交。
- 在 `main` 形成主工作区多 Agent 设置独立提交，保留用户现有改动。
- 将普通聊天提交合并到 `main`，解决重叠文件冲突并保留两边功能。
- 运行合并后的类型检查、构建、Rust 测试和差异检查。
- 重启主工作区桌面开发模式并验证 5173/3001。

Out of scope:

- 不执行 reset、checkout 丢弃改动或覆盖另一 worktree。
- 不推送远端，不修改提交历史，不处理与本次两个功能无关的旧问题。

## Impact

- Git：普通聊天提交、设置提交和 main 合并提交。
- Code：重叠文件需要人工合并；普通聊天新增模块和设置页能力都必须保留。
- Runtime：合并后只重启主工作区服务，不停止普通聊天隔离服务，除非确认其已不再需要。

## Acceptance Criteria

- [ ] 普通聊天和多 Agent 设置均形成可追溯提交。
- [ ] `main` 合并后工作树无未预期冲突标记，重叠文件同时保留两边功能。
- [ ] 合并后 Rust/TypeScript/生产构建和 Git 差异检查通过。
- [ ] 主工作区桌面开发服务 5173/3001 健康；普通聊天入口和设置入口代码均存在。
- [ ] 不推送远端，不丢弃用户已有修改。

## Verification Commands

- `git status --short --branch`
- `git diff --check && git diff --cached --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck && npm run build`
- 主工作区 `http://127.0.0.1:5173/` 与 `http://127.0.0.1:3001/api/health`

## Implementation Record
- 2026-07-14T01:28:55.552Z 普通聊天提交 339a3a2 与多 Agent 设置提交 06fdd91 已分别形成；main 合并时保留 toml_edit 与 toml 依赖、合并 backend MCP 配置函数，并更新一个普通聊天附件回归断言以覆盖无项目目录内联图片语义

- 2026-07-14T00:58:27.788Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T01:28:56.505Z `主工作区服务健康检查`: 通过：桌面开发模式运行，127.0.0.1:5173、3001 health/bootstrap 返回 200；隔离 5174、3101 仍返回 200

- 2026-07-14T01:28:56.141Z `npm run typecheck && npm run build && node --import tsx --test src/**/*.test.ts`: 合并后通过：TypeScript、生产构建和前端 431/431 回归全部通过；仅保留既有大 chunk 提示
- 2026-07-14T01:28:55.838Z `cargo test --manifest-path src-tauri/Cargo.toml`: 合并后通过：lib 86 通过、1 个真实 Grok 测试忽略；desktop main 9/9；普通聊天与多 Agent 后端测试均通过

## Completion Summary
- 2026-07-14T01:28:56.877Z 普通 AI 聊天已安全合并到 main：339a3a2 普通聊天提交、06fdd91 多 Agent 设置提交、eece0a1 合并提交；冲突文件已保留双方功能，合并后 Rust/前端全量验证和主桌面服务健康检查通过。

## Follow-ups

- 合并完成后如需推送，另行执行并先检查敏感信息和提交内容。
