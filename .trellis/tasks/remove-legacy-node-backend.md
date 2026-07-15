# Task: 清理遗留 Node 后端

## Background

CodeM 当前开发、桌面运行和发布链路均已切换为 Rust + Axum + Tauri。`server/**` 旧实现已不在 TypeScript project include 中，`package.json` 也已移除 Express 依赖。这些失活代码会造成双后端认知漂移、无效修复进入主线和文档误导。

## Objective

移除已退出运行与发布主线的 Node Express 后端及失效引用，保留当前 Rust/Tauri 功能、测试契约和历史文档可追溯性

## Scope

In scope:

- 删除 `server/**` 遗留 Node Express 后端与其专属测试。
- 删除或迁移仍直接读取 Node 源码的活动测试与 spike 脚本。
- 更新 README、AGENTS、CLAUDE、Trellis backend 规范和当前开发说明，统一为 Rust 后端。
- 核对 Rust 路由、持久化、Agent/MCP/Skills/插件能力仍有对应实现和测试覆盖。

Out of scope:

- 不改 Rust API、SQLite schema、Agent 运行协议或前端数据契约。
- 不删除历史 `docs/superpowers/**`、旧设计稿和 Git 历史中的 Node 架构记录。
- 不与当前未提交的失焦完成提示修复混合业务逻辑。
- 不新增 Node 后端兼容层或运行兜底。

## Impact

- 删除约 38 个 `server/**` 文件及对应失活测试。
- 调整仍把 Node 文件作为源码断言对象的少量前端/集成测试。
- 更新开发与后端规范入口，避免后续继续向 `server/**` 写代码。
- 当前桌面运行、用户数据和 Rust API 行为不变。

## Acceptance Criteria

- [x] `server/**` 不再存在，活动源码、脚本和测试不再依赖该目录。
- [x] `npm run dev`、`npm run desktop:dev`、打包与 release 均继续只使用 Rust 后端。
- [x] README、AGENTS、CLAUDE 和 `.trellis/spec/backend/**` 不再把 Express/Node 描述为当前架构。
- [x] Rust backend 路由、持久化、Claude/Agent、MCP、Skills、插件和文件能力测试保持通过。
- [x] 前端全量测试、TypeScript 检查、生产构建和 Git 差异检查通过。
- [x] 用户现有未提交改动与 `CONTEXT.md` 保持不变。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- 前端全量 `node --test --import tsx` 测试集合
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 运行中的桌面开发版：Web 5173、Rust backend 3001 健康检查

## Implementation Record

- 2026-07-15T07:13:47.169Z 遗留 Node 清理收口：移除无引用的 concurrently 与顶层 esbuild 直接依赖，最终保护核对确认 38 个 server 文件删除、用户改动与 CONTEXT.md 保留、暂存区为空。
- 2026-07-15T07:08:00.374Z 遗留 Node 清理：已删除 server 下 38 个旧实现/测试文件、2 个 Node 专属测试和失活 spike，移除空目录；当前架构文档已统一为 Rust，定向前端测试 44/44 通过，进入全量门禁。

- 2026-07-15T07:02:37.086Z 遗留 Node 清理：新增 Rust workspace 路径与 slash command 目录行为测试，定向验证分别通过 3/3 和 1/1，开始删除失活 Node 实现与专属测试。
- 2026-07-15T06:57:09.579Z 完成遗留 Node 活动引用与测试基线盘点：4 组旧引用测试 35/35 通过，但部分仅为 Node 源码正则断言。决定先补 Rust 文件搜索、路径解析和 slash command 行为测试，再删除旧实现与源码断言。

- 2026-07-15T06:51:11.933Z Task created by Trellis automation.

## Verification Results
- 2026-07-15T07:13:52.302Z `GET 3001/api/health 与 GET 5173/`: Rust backend 与 Web 均返回 200

- 2026-07-15T07:13:51.587Z `git diff --check`: 通过；server 目录不存在，活动引用扫描无命中
- 2026-07-15T07:13:50.852Z `npm run build`: 通过，仅有既有 chunk 与动态导入提示

- 2026-07-15T07:13:50.138Z `npm run typecheck`: 通过
- 2026-07-15T07:13:49.446Z `node --import tsx --test <94 个 TypeScript 测试文件>`: 538/538 通过

- 2026-07-15T07:13:48.673Z `cargo test --manifest-path src-tauri/Cargo.toml`: lib 109 通过、1 个真实 Grok smoke 按设计忽略；desktop 9/9 通过
- 2026-07-15T07:13:47.937Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：lib 109 通过、1 个真实 Grok smoke 按设计忽略；desktop 9/9 通过。
- 全量 TypeScript 测试：94 个文件、538/538 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅有既有动态/静态导入和大 chunk 提示。
- `git diff --check`：通过。
- `http://127.0.0.1:3001/api/health` 与 `http://127.0.0.1:5173/`：均返回 200。
- 最终扫描：`server` 目录不存在，活动代码/当前文档无旧 Node 实现引用；暂存区为空。

## Completion Summary
- 2026-07-15T07:14:06.142Z 已删除遗留 Node Express 后端及专属测试/spike，移除无引用旧构建依赖，补充 Rust 行为测试并统一现行架构文档；Rust、TypeScript、构建、差异和运行健康门禁全部通过，用户原有改动与数据未受影响。

已删除失活 Node Express 后端、专属测试和 spike 脚本，补充 Rust 行为测试，迁移仍有效的前端测试，移除旧 Node 构建依赖，并将当前开发文档统一为 Rust/Axum/Tauri 架构。Rust API、SQLite schema、Agent/普通聊天运行机制和用户数据未修改。

## Follow-ups

- 历史设计文档保留原始 Node 架构语境；如需进一步整理，单独做历史文档归档任务。
