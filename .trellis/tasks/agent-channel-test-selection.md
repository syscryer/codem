# Task: 修复新增渠道测试后跳回系统渠道

## Background

新增 CodeM Agent 渠道后，点击“测试连接”会先保存并刷新渠道 bootstrap。刷新完成前父层可能仍传入旧列表，导致设置页把刚保存的渠道误判为不存在并回退到系统渠道。

## Objective

新增渠道首次测试连接后，在 bootstrap 刷新完成前保持当前渠道选中，刷新完成后继续展示新渠道。

## Scope

In scope:

- 保存/更新渠道后的选中状态保护。
- 渠道 bootstrap 刷新期间的前端回归测试。

Out of scope:

- 测试连接 API、渠道持久化和 Agent 运行链路。

## Impact

- 仅影响 Agent 渠道设置页的本地选择状态；不改变渠道数据和测试请求。

## Acceptance Criteria

- [x] 新增渠道首次测试连接时保持新渠道选中。
- [x] bootstrap 刷新带回新渠道后清除临时保护并正常同步表单。
- [x] 用户主动切换厂商、系统渠道或其他渠道时不继承旧保护。

## Verification Commands

- `npm run typecheck`
- `npx tsx --test src/lib/agent-channel-selection.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-18T12:54:16.079Z 新增渠道保存后记录待确认选中 ID；bootstrap 刷新期间若列表暂时没有该渠道则保持选中，刷新带回后自动清除保护；用户主动切换渠道、厂商或新建流程时清理保护。

- 2026-07-18T12:52:33.677Z Task created by Trellis automation.

## Verification Results

- 2026-07-18T12:55:07.555Z `npm run build`: 通过：Vite 生产构建完成；仅保留仓库既有 Tauri 动态导入与大 chunk 警告。
- 2026-07-18T12:54:16.448Z `npm run typecheck; npx tsx --test src/lib/agent-channel-selection.test.ts; git diff --check`: 通过：TypeScript 类型检查、渠道选择回归测试 11/11、diff whitespace 检查。

## Completion Summary
- 2026-07-18T12:55:07.900Z 修复新增/更新 Agent 渠道保存后 bootstrap 刷新期间误回退到系统渠道的问题；增加待确认选中状态保护和回归测试，类型检查、定向测试、生产构建均通过。

## Follow-ups

- 无。
