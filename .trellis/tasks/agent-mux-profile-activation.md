# Task: 优化 Agent Mux 配置保存与全部视图

## Background

Agent Mux 新建运行配置后默认停用，用户必须退出配置抽屉并在列表中再次测试才能启用；同时配置列表只能按单个 Agent 查看，集中维护成本较高。

## Objective

新增全部配置管理视图、侧边窗口连接测试，并让新配置保存后自动检测启用

## Scope

In scope:

- Agent 列表增加固定的“全部配置”入口，并聚合展示所有 Agent 的运行配置。
- 配置抽屉增加不落库的“测试连接”操作和就地结果反馈。
- 新建配置保存后自动检测并落为可用或连接失败；仅用户主动停用时使用 disabled。
- 编辑配置时，仅渠道或模型变化触发重新检测，其他元数据修改保持原状态。

Out of scope:

- 不修改 Agent Mux 数据库结构和后端持久化协议。
- 不复制或迁移渠道密钥，不调整 Runtime 调用协议。
- 不移除列表中现有的测试、启停、编辑和删除操作。

## Impact

- Frontend: `src/components/AgentMuxPrototype.tsx`
- Regression tests: `src/lib/agent-mux-ui.test.ts`

## Acceptance Criteria

- [x] Agent 配置页默认显示“全部配置”，可聚合查看并维护所有已有运行配置。
- [x] 配置抽屉可以测试当前 Agent、渠道和模型组合，测试不会保存配置。
- [x] 渠道或模型变化后，抽屉中旧测试结果立即失效。
- [x] 新配置通过“保存并启用”落库，随后自动检测并更新为 available 或 offline。
- [x] 编辑未改变渠道或模型时保持原状态；改变后自动重新检测。
- [x] 现有单 Agent 配置维护操作与标准主题下拉保持可用。

## Verification Commands

- `node --import tsx --test src/lib/agent-mux-ui.test.ts`
- `npm run typecheck`
- `npm run build`

## Implementation Record
- 2026-08-11T01:47:26.465Z 完成 Agent Mux 全部配置聚合视图、配置抽屉测试连接，以及新建或连接信息变更后的自动检测启用；连接失败统一落为 offline，元数据编辑保持原状态。

- 2026-08-11T01:27:01.984Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T01:47:26.527Z `npm run typecheck`: pass

- 2026-08-11T01:47:26.511Z `npm run build`: pass: Vite production build completed; existing chunk-size warnings only
- 2026-08-11T01:47:26.456Z `node --import tsx --test src/lib/agent-mux-ui.test.ts`: pass: 19 tests

## Completion Summary
- 2026-08-11T01:48:46.569Z Agent Mux 配置页新增全部配置聚合入口；配置抽屉支持不落库测试连接；新建配置及渠道或模型变更后自动检测并启用或标记离线。回归测试、类型检查和生产构建均通过。

## Follow-ups

- 无。
