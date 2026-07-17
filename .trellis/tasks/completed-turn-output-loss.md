# Task: 修复完成回合结果偶发丢失

## Background

用户和本机均复现：Agent 回合已经完成并产生正文后，当前回合偶发被替换为空正文的“已停止”状态。安装版 SQLite 中对应 assistant text、thinking 和工具记录仍完整，说明数据已经正确落库，丢失发生在前端历史回显合并阶段。当前 `loadThreadHistory` 只保护 pending/running turn；历史请求发出后若本地 turn 完成，迟到的旧 stopped 快照会覆盖已经完成的本地结果。近期长会话异步加载和历史 checkpoint 优化放大了该竞态。

## Objective

定位并修复 Agent 回答完成后当前回合 assistant 输出被清空或收口为已停止的近期回归

## Scope

In scope:

- 为历史加载与当前内存 timeline 增加可测试的合并规则。
- 历史请求期间本地 turns 发生变化时，以当前内存 turns 为准，同时补入历史独有的旧 turns。
- 即使没有检测到请求期间变化，空正文的历史快照也不能覆盖已有可见结果。
- 保留主动 force refresh 在无本地变化时刷新已有完成回合的能力。
- 补充该竞态的前端回归测试并重启桌面开发模式验证。

Out of scope:

- 不修改 Claude/Agent 事件协议、SQLite schema 或后端 history API。
- 不通过隐藏“已停止”状态或伪造正文掩盖问题。
- 不在本任务中调整长会话分页和持久化频率。

## Impact

- `src/hooks/useWorkspaceState.ts`
- `src/lib/conversation.ts`
- `src/lib/conversation.test.ts`

## Acceptance Criteria

- [x] 迟到的 stopped/空正文历史快照不能覆盖已完成且有正文的当前 turn。
- [x] 历史请求期间新增或更新的当前 turns 在 force refresh 下仍被保留。
- [x] 没有本地变化时，force refresh 仍可使用后端历史更新缓存。
- [x] 现有实时 turn、历史恢复和持久化测试全部通过。
- [x] 桌面开发模式重启后前后端健康检查通过。

## Verification Commands

- `node --import tsx --test src/lib/conversation.test.ts src/hooks/useWorkspaceState.history-persistence.test.ts`
- `node --import tsx --test src/hooks/*.test.ts src/lib/*.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record

- 2026-07-17T10:16:52.884Z 核对安装版数据库：复现 turn 包含 3 个 Agent 工具任务，均为 done 且结果完整。子代理不是数据丢失源，而是通过延长运行和增加 sidechain/tool 更新提高竞态概率；新增工具卡可见性和子代理状态更新两项回归测试。
- 2026-07-17T09:55:11.179Z 根因已确认：安装版 SQLite 中复现会话的 assistant text/thinking 完整，丢失发生在前端 loadThreadHistory 合并。历史请求发出后本地 turn 完成时，迟到的 stopped/空正文快照因只保护 live turn 而覆盖当前结果。已先补失败测试，再实现可见结果优先与请求期间本地 turns 变更保护。

- 2026-07-17T09:34:00.370Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T10:17:38.931Z `node --import tsx --test src/lib/conversation.test.ts && npm run typecheck`: 19 项 conversation 测试通过，其中 2 项为子代理专用回归；类型检查通过
- 2026-07-17T10:04:40.118Z `desktop dev restart; curl --noproxy '*' runtime identity and web root`: codem.exe PID 52376；Rust backend identity 正常；Vite HTTP 200

- 2026-07-17T09:59:42.754Z `npm run typecheck && git diff --check`: 类型检查通过；无 whitespace error，仅现有 LF/CRLF 行尾提示
- 2026-07-17T09:58:59.608Z `node --import tsx --test src/hooks/*.test.ts src/lib/*.test.ts`: 505 项通过，0 失败；新增历史迟到覆盖竞态 4 项回归测试通过

## Completion Summary

- 2026-07-17T10:18:20.033Z 确认子代理仅放大迟到历史覆盖竞态，不存在独立持久化丢失；补充子代理工具结果和状态更新回归测试并通过。
- 2026-07-17T10:05:52.001Z 修复迟到历史响应覆盖已完成回合的竞态：请求期间本地 turns 变化时保留内存结果，空正文历史快照不再降级已有可见输出，同时保留正常 force refresh；505 项前端测试和桌面健康检查通过。

## Follow-ups

- 如果后续需要跨设备/多窗口并发编辑，再为 history API 增加服务端 revision；本次单窗口竞态不需要扩展协议。
