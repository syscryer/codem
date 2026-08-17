# Task: 移动实时状态、断线恢复与 Agent 配置对齐

## Background

移动会话详情在没有活动 run 时会收到一次 `idle` SSE，服务端随后正常结束该响应。浏览器的 EventSource 会自动重连并触发 `error`，现有 hook 将所有 error 都显示为“重连中”，导致已空闲、可继续的会话标题状态错误。与此同时，全局 `/api/mobile/events` 使用命名 `sync` 事件，前端却只监听默认 message；连接失败后还会关闭流且不会稳定重建，任务列表实时刷新与断线恢复不完整。

移动新建任务还把模型目录为空时的推理强度硬编码为“低/中/高”，导致 Claude Code 误用普通聊天式兜底，遗漏桌面端真实的默认、Low、Medium、High、XHigh、Max、Ultracode 思考级别；权限可见值和 Provider 能力判断也存在重复定义。

接入桌面 Claude 模型目录后，详情页模型 effect 直接依赖 bootstrap 的 channels 数组。全局 `sync` 每次刷新都会产生新数组，导致目录被周期性清空和重载，打开的模型底部面板持续改变高度。

## Objective

修复移动会话空闲时错误显示重连中，并确保任务列表全局事件流断线后自动恢复

## Scope

In scope:

- 区分“空闲/终态后的预期 SSE 结束”与活动 run 的异常断线。
- 会话标题只在活动任务确实断线时显示“重连中”，空闲任务显示“已同步”。
- 全局事件流监听后端真实的 `sync` 事件名。
- 全局事件流异常后关闭旧连接、刷新快照并自动重建连接。
- 增加移动端状态与重连源代码回归测试。
- 将 Claude Code 思考级别提取为桌面/移动共享常量，移动端不再维护普通聊天式兜底。
- 非 Claude Provider 仅在桌面模型目录明确声明 `supportedReasoningEfforts` 时展示思考级别。
- 移动权限选项复用桌面 `permissionMenuModes` 和统一标签。
- Claude Code 系统渠道模型通过移动网关复用桌面 `/api/claude/models`，只返回脱敏模型目录。
- 模型目录刷新依赖稳定的 Provider/渠道/模型内容签名，不依赖 bootstrap 数组引用。

Out of scope:

- 不修改桌面端事件协议、会话状态和样式。
- 不新增后端事件类型或持久化字段。
- 不在本任务实现通知中心、项目新建入口或公网推送。
- 不改变桌面 Claude Code 当前可见模型、思考级别或权限行为。

## Impact

- Frontend: `src/mobile/hooks/useMobileThread.ts`、`src/mobile/hooks/useMobileWorkspace.ts`、`src/mobile/pages/TaskDetailPage.tsx` 和移动专项测试。
- Backend contract: 保持现有 `idle`、`agent`、`sync` 事件语义不变；移动模型目录端点为 Claude Code 代理桌面模型列表并保持独立脱敏边界。
- 刷新恢复：重连前先调用 bootstrap refresh，详情页继续使用 thread snapshot + cursor 恢复。
- Terminal event：done/error/stopped 后流状态保持 idle，不显示异常重连。

## Acceptance Criteria

- [x] 无活动 run 的详情页显示“已同步”，不再短暂或持续显示“重连中”。
- [x] 活动 run 的 SSE 真正断线时仍显示“重连中”。
- [x] 收到 terminal event 后状态保持 idle，并按现有机制刷新历史。
- [x] 全局 `sync` 事件能够触发 workspace refresh。
- [x] 全局事件流断线后会刷新快照并自动创建新 EventSource。
- [x] 改动仅位于移动端，桌面入口和事件协议不变。
- [x] Claude Code 移动新建任务显示与桌面一致的七档思考级别，默认不向后端发送显式 effort。
- [x] Codex 只显示模型目录声明的思考级别，Grok/OpenCode 等无能力声明时不显示该字段。
- [x] 移动权限菜单与桌面可见权限值保持一致，不再发送 `acceptEdits` 作为 UI 选项。
- [x] Claude Code 系统渠道可读取桌面同源的默认、Sonnet、Opus、Haiku 模型选项，不暴露环境配置。
- [x] 周期 workspace sync 不再清空或重拉未变化的模型目录，打开的选择面板保持稳定。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npx tsx --test src/mobile/mobile-agent-options.test.ts`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_claude_model_catalog`
- `git diff --check`

## Implementation Record

- 2026-07-20T15:00:32.479Z 模型目录改用稳定 Provider/渠道/模型内容签名，workspace 周期同步不再清空并重载目录，修复打开的模型选择面板持续改变高度。
- 2026-07-20T14:41:23.611Z 修复移动实时状态：idle/terminal 后的预期 SSE 结束不再显示重连中；全局事件改为监听后端命名 sync 事件，并在失败后刷新快照、重建 EventSource。同步审计 Agent 配置来源：Claude 思考级别提取为桌面/移动共享常量，Codex 只使用模型目录能力，权限复用桌面可见菜单；Claude 系统模型通过移动网关脱敏代理桌面 /api/claude/models。

- 2026-07-20T14:22:45.399Z Task created by Trellis automation.

## Verification Results
- 2026-07-20T15:01:05.454Z `git diff --check`: pass

- 2026-07-20T15:00:59.262Z `npm run build`: pass: MobileApp-CfMbY8pm.js
- 2026-07-20T15:00:49.715Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 13 tests

- 2026-07-20T15:00:38.947Z `npm run typecheck`: pass
- 2026-07-20T14:41:32.209Z `git diff --check`: pass with existing line-ending warnings only

- 2026-07-20T14:41:30.939Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass
- 2026-07-20T14:41:29.741Z `npm run build`: pass: desktop CSS hash unchanged styles-Ib9hzUXV.css

- 2026-07-20T14:41:28.452Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_claude_model_catalog`: pass: 1 test
- 2026-07-20T14:41:27.245Z `npx tsx --test src/mobile/mobile-agent-options.test.ts`: pass: 3 tests

- 2026-07-20T14:41:25.759Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 12 tests
- 2026-07-20T14:41:24.601Z `npm run typecheck`: pass

## Completion Summary

- 2026-07-20T15:01:13.627Z 修复移动模型选择面板因 workspace 周期同步反复清空目录造成的展开折叠；模型目录只在真实配置变化时刷新，类型检查、13 项专项测试和生产构建通过。
- 2026-07-20T14:45:47.499Z 完成移动实时状态、断线恢复与 Agent 配置对齐：空闲会话显示已同步，活动断线才显示重连中；全局 sync 事件可刷新并自动重连；Claude/Codex 思考级别、权限和 Claude 系统模型均改为复用桌面真实数据源并经移动网关脱敏。类型、专项测试、Rust 测试、生产构建和格式检查通过。

## Follow-ups

- 通知中心、项目新建入口、PWA 真机验收和浏览器 E2E 后续按移动伴侣清单继续推进。
