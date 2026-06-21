# Task: Trellis Automation Workflow And Session Record

## Background

CodeM 已经把 `.trellis/` 定为强制项目管理入口，但目前只有规范文档和任务目录，缺少可执行的 workflow / session record 闭环。实际开发容易只停留在聊天上下文里，导致需求边界、验证结果和遗留问题无法稳定沉淀。

## Objective

建立首版 Trellis 自动化 CLI，让后续开发可以用命令创建任务、记录当前 session、追加实现记录、登记验证结果并完成 session。

## Scope

In scope:

- 新增本地 Node CLI 脚本。
- 支持 task + session record 文件生成。
- 支持当前 session 状态查询。
- 支持追加实现记录和验证记录。
- 支持完成 session 并写回任务文件。
- 在 `package.json` 暴露 npm script。
- 更新 `.trellis/workflow.md` 使用说明。

Out of scope:

- 不接入数据库。
- 不做前端 UI。
- 不做多 agent orchestration。
- 不自动提交 git。
- 不强制解析或改写所有旧 `.trellis/tasks/*` 文件格式。

## Impact

- `.trellis/tasks/**`
- `.trellis/workspace/**`
- `scripts/**`
- `package.json`
- `.trellis/workflow.md`

## Acceptance Criteria

- [x] `npm run trellis -- start <slug> --title "..."`
  - 创建或复用 `.trellis/tasks/<slug>.md`
  - 创建 `.trellis/workspace/sessions/<session-id>.md`
  - 写入 `.trellis/workspace/current-session.json`
- [x] `npm run trellis -- status` 能展示当前 session 和 task。
- [x] `npm run trellis -- record "..."` 能追加 session note，并同步写入任务实现记录。
- [x] `npm run trellis -- verify "command" --result "..."` 能追加验证记录。
- [x] `npm run trellis -- complete --summary "..."` 能写入完成摘要并清除 current session。
- [x] 自动化脚本有单元测试覆盖。

## Verification Commands

- `node --test scripts/trellis.test.mjs`
- `node --test scripts/dev-session.test.mjs scripts/doctor.test.mjs`

## Implementation Record
- 2026-06-21T17:50:51.808Z 新增 scripts/trellis.mjs 和 scripts/trellis.test.mjs，提供 start/status/record/verify/complete 本地 Trellis CLI。

- 2026-06-22: 创建任务记录，准备实现首版 Trellis CLI。

## Follow-ups

- 后续可把 session record 与 CodeM UI 的设置页或工作台状态联动。
- 后续可增加 task checklist 检查、模板化任务类型和自动 diff 摘要。

## Verification Results
- 2026-06-21T17:51:30.863Z `node --test scripts/dev-session.test.mjs scripts/doctor.test.mjs`: pass 7/7

- 2026-06-21T17:51:12.828Z `node --test scripts/trellis.test.mjs`: pass 5/5

## Completion Summary

- 2026-06-21T17:52:10.840Z 完成首版 Trellis CLI、workflow 文档和 session record 闭环，并通过脚本测试验证。
