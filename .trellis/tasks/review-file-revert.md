# Task: 审查文件增加回滚操作

## Background

工作台右侧“审查文件”列表已经支持查看变更、选择提交文件、提交和推送，但文件右键菜单只有预览、打开、复制路径和删除。用户在审查单个变更文件时缺少“放弃本地改动”的明确入口，容易误用删除。

## Objective

在工作台审查文件列表中为变更文件提供明确且带确认的回滚本地改动操作

## Scope

In scope:

- 在审查文件的变更文件和变更目录右键菜单中增加“回滚改动”。
- 在底部提交栏增加“回滚选中”，支持按当前勾选文件批量回滚。
- 目录右键回滚时，按右键所在的变更分组回滚该目录下的变更文件。
- 未进行版本管理的文件和目录支持“添加到 Git”，底部栏也支持将当前勾选的未跟踪文件添加到 Git。
- 已跟踪文件恢复到 `HEAD`，同时清理暂存区和工作区改动。
- 未跟踪文件或相对 `HEAD` 新增的文件，回滚时从磁盘删除。
- 操作前必须确认，操作后刷新审查列表和项目 Git 摘要，并关闭对应的变更预览标签。
- 后端保留项目相对路径校验和 Git 状态校验，避免跨目录路径。

Out of scope:

- 不做历史提交的 `git revert`。
- 不在冲突文件上提供该入口，冲突仍通过冲突总览处理。
- 不重做审查文件列表整体布局。

## Impact

- frontend：`src/components/RightWorkbench.tsx`、`src/lib/git-api.ts`、`src/types.ts`
- backend：`server/index.ts`、`server/lib/workspace-store.ts`
- tests：Git API 调用测试、workspace-store Git 行为测试

## Acceptance Criteria

- [x] 审查文件右键菜单对非冲突变更文件和目录展示“回滚改动”。
- [x] 底部提交栏可对当前勾选文件执行“回滚选中”。
- [x] 点击回滚前有确认文案，说明影响文件数量、已跟踪文件恢复到 `HEAD`、未跟踪或新增文件会删除。
- [x] 已跟踪文件批量回滚后不再出现在审查文件列表中，暂存和未暂存改动都被清掉。
- [x] 未跟踪或新增文件回滚后从磁盘删除，并从审查文件列表中消失。
- [x] 目录右键只回滚该目录下、当前右键分组内的变更文件，兄弟目录或根目录其它变更保留。
- [x] 未进行版本管理的文件或目录可以通过右键菜单添加到 Git。
- [x] 勾选未跟踪文件后，底部栏可以批量添加到 Git，添加后文件进入已跟踪新增状态。
- [x] 操作完成后刷新项目 Git 摘要，并关闭对应审查预览标签。
- [x] 冲突文件不走该入口，仍通过冲突总览处理。

## Verification Commands

- `npx tsx --test src/lib/git-api.test.ts`
- `npx tsx --test server/lib/workspace-store-git.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-07-04T02:24:20.410Z 补充未跟踪文件添加到 Git：后端新增 git/add-files，前端在未跟踪文件/目录右键菜单提供添加到 Git，并在底部栏对勾选的未跟踪文件显示添加到 Git 按钮。

- 2026-07-04T02:15:38.745Z 根据用户补充需求，回滚范围从单文件扩大为：右键变更目录按所在分组回滚该目录下文件；提交栏支持对当前勾选文件执行批量回滚；后端接口接受 paths 数组并按 Git 状态展开目标。
- 2026-07-04T02:02:41.169Z 实现范围确定为审查文件单文件回滚：右键菜单新增回滚改动；后端新增 git/revert-file，已跟踪文件走 git restore，未跟踪或相对 HEAD 新增文件删除；冲突文件不通过该入口处理。

- 2026-07-04T01:51:33.680Z Task created by Trellis automation.

## Verification Results

- 2026-07-04T02:26:23.113Z `npx tsx --test server/lib/workspace-store-git.test.ts`: 通过，16 个后端 Git 行为测试全部通过，覆盖单文件回滚、目录回滚、未跟踪文件添加到 Git。
- 2026-07-04T02:26:22.995Z `npm run typecheck`: 通过，tsc -b 类型检查无错误。

- 2026-07-04T02:26:22.916Z `npx tsx --test src/lib/git-api.test.ts`: 通过，10 个 Git API 客户端测试全部通过，覆盖回滚 paths 和 add-files 请求体。
- 2026-07-04T02:17:46.593Z `npx tsx --test server/lib/workspace-store-git.test.ts`: 通过，15 个后端 Git 行为测试全部通过，覆盖单文件回滚、未跟踪文件删除、目录目标只回滚子路径变更。

- 2026-07-04T02:17:46.592Z `npm run typecheck`: 通过，tsc -b 类型检查无错误。
- 2026-07-04T02:17:46.563Z `npx tsx --test src/lib/git-api.test.ts`: 通过，9 个 Git API 客户端测试全部通过，覆盖单文件和多文件回滚请求体。

## Completion Summary
- 2026-07-04T02:26:37.699Z 审查文件支持目录/批量回滚和未跟踪文件添加到 Git：右键变更文件/目录可回滚，提交栏可回滚选中；右键未跟踪文件/目录可添加到 Git，勾选未跟踪文件后底部栏也可添加；后端新增 paths 级回滚和 add-files 接口，测试和类型检查通过。

## Follow-ups

- 后续如需要批量回滚，可基于本次单文件接口单独设计选中态和二次确认。
