# Session Record: 审查文件增加回滚操作

- Session: session-20260704-015133-19mi
- Started: 2026-07-04T01:51:33.677Z
- Task: .trellis/tasks/review-file-revert.md

## Notes
- 2026-07-04T02:24:20.410Z 补充未跟踪文件添加到 Git：后端新增 git/add-files，前端在未跟踪文件/目录右键菜单提供添加到 Git，并在底部栏对勾选的未跟踪文件显示添加到 Git 按钮。

- 2026-07-04T02:15:38.745Z 根据用户补充需求，回滚范围从单文件扩大为：右键变更目录按所在分组回滚该目录下文件；提交栏支持对当前勾选文件执行批量回滚；后端接口接受 paths 数组并按 Git 状态展开目标。
- 2026-07-04T02:02:41.169Z 实现范围确定为审查文件单文件回滚：右键菜单新增回滚改动；后端新增 git/revert-file，已跟踪文件走 git restore，未跟踪或相对 HEAD 新增文件删除；冲突文件不通过该入口处理。

- 2026-07-04T01:51:33.681Z Session started.

## Verification

- 2026-07-04T02:26:23.113Z `npx tsx --test server/lib/workspace-store-git.test.ts`: 通过，16 个后端 Git 行为测试全部通过，覆盖单文件回滚、目录回滚、未跟踪文件添加到 Git。
- 2026-07-04T02:26:22.995Z `npm run typecheck`: 通过，tsc -b 类型检查无错误。

- 2026-07-04T02:26:22.916Z `npx tsx --test src/lib/git-api.test.ts`: 通过，10 个 Git API 客户端测试全部通过，覆盖回滚 paths 和 add-files 请求体。
- 2026-07-04T02:17:46.593Z `npx tsx --test server/lib/workspace-store-git.test.ts`: 通过，15 个后端 Git 行为测试全部通过，覆盖单文件回滚、未跟踪文件删除、目录目标只回滚子路径变更。

- 2026-07-04T02:17:46.592Z `npm run typecheck`: 通过，tsc -b 类型检查无错误。
- 2026-07-04T02:17:46.563Z `npx tsx --test src/lib/git-api.test.ts`: 通过，9 个 Git API 客户端测试全部通过，覆盖单文件和多文件回滚请求体。

## Completed

- 2026-07-04T02:26:37.699Z 审查文件支持目录/批量回滚和未跟踪文件添加到 Git：右键变更文件/目录可回滚，提交栏可回滚选中；右键未跟踪文件/目录可添加到 Git，勾选未跟踪文件后底部栏也可添加；后端新增 paths 级回滚和 add-files 接口，测试和类型检查通过。
