# Task: 修复渠道模型无法切换

## Background

Pi 使用自定义 MiniMax 渠道时，模型菜单同时显示“默认（当前：MiniMax-M3）”和显式 `MiniMax-M3`。点击显式模型后，触发器仍立即回到“默认”。

根因是 `useAgentRun` 每次渲染都会重新调用 `buildAgentChannelModelCatalog` 并生成新对象，依赖该对象的线程模型恢复副作用因此在模型状态更新后再次执行。空白会话没有已保存模型，恢复结果会覆盖用户刚选择的显式模型。

## Objective

稳定自定义 Agent 渠道模型目录，避免空白会话选择显式模型后被恢复逻辑重置为默认。

## Scope

In scope:

- 稳定当前渠道模型目录的引用。
- 保留“默认”和“显式选择渠道默认模型”的不同语义。
- 增加回归测试并在桌面端验证 Pi + MiniMax 渠道。

Out of scope:

- 修改渠道模型数据结构或后端协议。
- 合并“默认”和显式模型菜单项。
- 修改线程模型偏好持久化格式。

## Impact

- Frontend: `src/hooks/useAgentRun.ts` 当前模型目录派生逻辑。
- Tests: `src/lib/agent-session-preferences.test.ts`。

## Acceptance Criteria

- [x] 空白 Pi 会话点击 `MiniMax-M3` 后触发器显示 `MiniMax-M3`，不回到“默认”。
- [x] 点击“默认”仍可恢复渠道默认跟随模式。
- [x] 已有线程的模型与 thinking level 恢复行为不变。
- [x] TypeScript 和相关前端测试通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-session-preferences.test.ts`
- `npm run typecheck`
- 桌面端打开 Pi + MiniMax 渠道模型菜单，依次选择显式模型和默认。

## Implementation Record

- 2026-07-26T09:58:31.988Z 实现：使用 useMemo 稳定当前渠道模型目录引用，仅在渠道、Provider 或原始目录变化时重建；新增回归测试，防止草稿模型状态变化触发恢复 effect 重置选择。
- 2026-07-26T09:47:33.650Z 根因确认：buildAgentChannelModelCatalog 在 useAgentRun 每次渲染时返回新对象，currentModelCatalog 依赖变化导致线程模型恢复 effect 在点击显式模型后重跑；空白会话 savedModelId 为空，因此覆盖为 __default。

- 2026-07-26T09:46:32.847Z Task created by Trellis automation.

## Verification Results
- 2026-07-26T09:59:07.628Z `桌面端 Pi + MiniMax 模型菜单交互`: 选择 MiniMax-M3 后触发器持续显示 MiniMax-M3；重新打开菜单仍保持显式选择；选择默认后触发器恢复默认；桌面窗口重启后正常渲染。

- 2026-07-26T09:58:55.173Z `npm run typecheck && npm run build`: TypeScript 编译通过；Vite 生产构建成功，保留仓库既有 chunk 与动态导入警告。
- 2026-07-26T09:58:42.502Z `node --import tsx --test src/lib/agent-session-preferences.test.ts`: 4 passed, 0 failed；覆盖自定义渠道模型目录引用稳定性。

## Completion Summary
- 2026-07-26T09:59:17.368Z 修复 Pi 自定义渠道模型选择被恢复逻辑立即覆盖的问题：稳定渠道模型目录引用，保留默认与显式模型语义；专项测试、类型检查、生产构建和桌面端双向切换验收均完成。

## Follow-ups

- 无。
