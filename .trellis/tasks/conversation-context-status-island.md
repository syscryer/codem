# Task: 会话状态迁移到上下文岛

## Background

底部状态栏中的工作区、Git 和会话运行状态与右上角“会话上下文”岛语义重叠，并额外占用聊天区域高度。用户已确认将这些入口收口到上下文岛，详情使用锚定弹层展示。

## Objective

将工作区、Git 与运行状态从底部状态栏迁移到会话上下文岛，并保留非 Git、窄窗口与弹层交互

## Scope

In scope:

- 将工作区、Git 分支和会话运行状态迁移到会话上下文岛。
- 复用现有分支切换、工作树切换、运行详情和 PopoverPortal 交互。
- 删除底部状态栏及其网格占位。
- 保留非 Git 项目的“未检测到 Git”提示，并保证窄窗口可通过上下文岛入口访问。

Out of scope:

- 不修改 Git、工作树或运行状态的数据获取和后端接口。
- 不重做会话上下文岛其他模块。

## Impact

- 影响聊天页布局、会话上下文岛、工作区/Git 菜单和会话运行详情弹层。

## Acceptance Criteria

- [ ] 宽屏下工作区、Git 和会话状态显示在上下文岛内，底部状态栏消失且不留空白。
- [ ] Git 项目可切换分支和工作树；非 Git 项目显示“未检测到 Git”。
- [ ] 点击会话状态以岛内入口为锚点打开原有详情弹层，点击外部可关闭。
- [ ] 窄窗口打开上下文岛后仍可访问上述入口。
- [ ] 类型检查、相关源码测试和差异检查通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/components/WorkspaceStatus.panel.test.ts src/lib/conversation-context-prototype.test.ts`
- `git diff --check`

## Implementation Record

- 2026-08-08T05:50:29.816Z 会话详情弹层压缩为 360px；当前会话指标改为两列；空耗时、空费用和空模型隐藏；Session ID 仅展示紧凑值且保留完整 title；连接信息合并为单行摘要；左侧 3px 锚定规则保持不变。
- 2026-08-08T05:30:07.175Z PopoverPortal left-start 新增 sideBoundarySelector，以会话岛外框而非条目内边缘计算横向位置；Git 分支、工作树和会话详情统一保持 3px 岛外间距。

- 2026-08-08T05:20:43.847Z 为 PopoverPortal 增加原生 left-start 定位和窄屏回退；Git 分支、工作树与会话详情统一使用左侧锚定，删除依赖弹层自身宽度的 CSS translate 模拟。
- 2026-08-08T05:08:26.320Z 将 WorkspaceStatus 以 island 变体嵌入 ConversationContextIsland；Git 工具、非 Git 提示、工作区与会话状态均按单行展示；工作树和会话详情弹层改为从岛向下展开；删除底部状态栏与 20px 网格占位，终端面板上移。

- 2026-08-08T04:55:44.406Z Task created by Trellis automation.

## Verification Results

- 2026-08-08T05:50:31.820Z `git diff --check`: pass
- 2026-08-08T05:50:31.130Z `node --import tsx --test src/lib/popover-portal.test.ts src/components/WorkspaceStatus.panel.test.ts src/lib/conversation-context-prototype.test.ts`: pass

- 2026-08-08T05:50:30.424Z `npm run typecheck`: pass
- 2026-08-08T05:30:51.647Z `npm run typecheck；18 项 Popover、WorkspaceStatus 与上下文岛测试；git diff --check`: 全部通过。

- 2026-08-08T05:21:07.890Z `npm run typecheck；node --import tsx --test src/lib/popover-portal.test.ts src/components/WorkspaceStatus.panel.test.ts src/lib/conversation-context-prototype.test.ts；git diff --check`: 通过：TypeScript 无错误；18 项相关测试全部通过；差异检查通过。
- 2026-08-08T05:08:50.087Z `npm run typecheck；node --import tsx --test src/components/WorkspaceStatus.panel.test.ts src/lib/conversation-context-prototype.test.ts；git diff --check`: 通过：TypeScript 无错误；13 项相关测试全部通过；差异检查通过。

## Completion Summary

- 2026-08-08T05:50:42.713Z 完成会话详情紧凑版：360px 宽、两列会话指标、空值隐藏、紧凑 Session ID、连接摘要与内容溢出滚动；保持左侧 3px 定位规则。类型检查、18 项相关测试及 diff 检查均通过。
- 2026-08-08T05:31:18.324Z 左侧弹层已按会话岛外框精确保留 3px 间距，不再受岛内条目 padding 影响。

- 2026-08-08T05:21:33.200Z 上下文岛的 Git 分支、工作区和会话状态弹层已改为可靠的左侧锚定定位，宽度变化不再导致漂移，窄屏自动回退。
- 2026-08-08T05:09:15.797Z 工作区、Git 与会话状态已从底部状态栏迁移到会话上下文岛，采用单行条目和锚定弹层；非 Git、窄窗口入口和终端布局保持可用。

## Follow-ups

- 暂无。
