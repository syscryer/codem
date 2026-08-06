# Task: 工作区文件搜索与忽略规则

## Background

当前 `@文件` 搜索只扫描四层目录，并在收集到 500 个匹配项后提前结束，导致深层文件或大工作区中的高质量匹配无法进入排序。

## Objective

取消工作区文件搜索的深度和匹配数量限制，永久排除 .git、node_modules、target、dist，并提供默认关闭的 .gitignore 过滤开关

## Scope

In scope:

- 默认搜索工作区内所有普通文件，不应用 `.gitignore`。
- 设置中提供“搜索时遵循 .gitignore”开关，默认关闭并全局持久化。
- `.git`、`node_modules`、`target`、`dist` 始终排除。
- 不限制目录深度，不按已发现匹配数量提前结束遍历。
- 完整遍历后只返回评分最高的 80 项，避免菜单一次渲染大量候选。

Out of scope:

- 不建设持久化文件索引。
- 不应用 Git 全局 ignore、`.git/info/exclude` 或 `.ignore`。

## Impact

- 前端设置类型、默认值、兼容归一化与基础设置页。
- Rust 设置归一化、文件搜索接口与遍历实现。
- 前后端设置和搜索回归测试。

## Acceptance Criteria

- [x] 四层以上目录中的文件可通过名称或相对路径搜索到。
- [x] 超过 500 个候选时，后遍历到的高质量匹配仍能进入返回结果。
- [x] 四个永久排除目录在开关关闭和开启时都不会被搜索。
- [x] 开关关闭时 `.gitignore` 命中的文件仍可搜索；开启后不可搜索。
- [x] 老设置缺少新字段时默认关闭，显式设置可持久化并生效。

## Verification Commands

- `node --import tsx --test src/lib/settings-api.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_file_search`
- `cargo test --manifest-path src-tauri/Cargo.toml settings`

## Implementation Record
- 2026-08-06T09:46:48.031Z 已将 @文件搜索改为完整 WalkBuilder 遍历：默认不遵循 .gitignore，四个目录永久排除；完整扫描后保留评分最高 80 项。新增基础设置开关和前后端回归测试。

- 2026-08-06T09:41:14.427Z Task created by Trellis automation.

## Verification Results

- 2026-08-06T09:57:21.611Z `npm run typecheck`: 阻断：既有 src/App.tsx 调用 useClaudeRun/useAgentRun 缺少 isNewChatDraft，与本任务改动无关
- 2026-08-06T09:57:21.584Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check; git diff --check`: 通过：Rust 格式检查和差异空白检查通过

- 2026-08-06T09:57:21.566Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：463 passed，1 ignored
- 2026-08-06T09:57:21.561Z `node --import tsx --test src/lib/settings-api.test.ts src/lib/file-reference-paths.test.ts`: 通过：31 个前端定向测试全部通过

## Completion Summary
- 2026-08-06T09:59:34.546Z 完成工作区 @文件搜索规则调整：取消目录深度和匹配扫描上限，使用 ignore WalkBuilder 完整遍历；.git、node_modules、target、dist 永久排除；新增默认关闭的 .gitignore 遵循开关并接入基础设置；Rust 全量测试和前端定向测试通过，全仓 typecheck 受既有 Agent Mux 参数错误阻断。

## Follow-ups

- 如超大仓库完整遍历仍有明显延迟，后续增加可取消的工作区文件索引，不回退到范围截断。
