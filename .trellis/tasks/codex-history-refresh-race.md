# Task: 修复完成回合历史刷新丢失

## Background

Agent 回合完成后会异步持久化历史。用户紧接着切换或刷新会话时，强制历史请求可能先拿到旧 SQLite 快照，并覆盖本地刚完成的最新回合。

## Objective

强制刷新返回旧历史快照时保留本地已完成且有可见结果的最新回合，避免 Codex/Agent 会话切换后最新对话暂时消失

## Scope

In scope:

- 强制刷新返回旧快照时，保留本地已完成且有可见输出的回合。
- 补充历史合并竞态的回归测试。

Out of scope:

- 不改变历史持久化协议和 SQLite 数据结构。
- 不调整 Claude Code 专属 JSONL 恢复逻辑。

## Impact

- 仅调整前端历史回合合并策略，覆盖所有 Agent Provider。

## Acceptance Criteria

- [x] 旧历史快照不能删除本地刚完成且有可见输出的回合。
- [x] 运行中和等待中的回合继续保留原有保护。
- [x] 后端更新的同 ID 已完成回合仍可正常回显。

## Verification Commands

- `node --test --import tsx src/lib/conversation.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record
- 2026-07-21T09:15:42.103Z 修复历史强制刷新竞态：当旧快照缺少本地已完成且有可见输出的最新回合时，保留本地回合；新增对应回归测试。

- 2026-07-21T09:12:35.933Z Task created by Trellis automation.

## Verification Results
- 2026-07-21T09:15:42.248Z `git diff --check`: 通过；仅有 Git 换行提示

- 2026-07-21T09:15:42.077Z `node --test --import tsx src/lib/conversation.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`: 26/26 通过
- 2026-07-21T09:15:42.045Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-21T09:15:51.153Z 完成历史刷新竞态修复：强制刷新遇到旧 SQLite 快照时保留本地已完成且有可见输出的回合，并补充回归测试。相关定向测试 26/26、typecheck、git diff --check 均通过。

## Follow-ups

- 如后续确认 Claude Code JSONL 仍存在独立旧快照覆盖，再单独处理该恢复链路。
