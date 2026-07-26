# Session Record: 修复渠道模型无法切换

- Session: session-20260726-094632-5pro
- Started: 2026-07-26T09:46:32.845Z
- Task: .trellis/tasks/agent-channel-model-selection.md

## Notes

- 2026-07-26T09:58:31.988Z 实现：使用 useMemo 稳定当前渠道模型目录引用，仅在渠道、Provider 或原始目录变化时重建；新增回归测试，防止草稿模型状态变化触发恢复 effect 重置选择。
- 2026-07-26T09:47:33.650Z 根因确认：buildAgentChannelModelCatalog 在 useAgentRun 每次渲染时返回新对象，currentModelCatalog 依赖变化导致线程模型恢复 effect 在点击显式模型后重跑；空白会话 savedModelId 为空，因此覆盖为 __default。

- 2026-07-26T09:46:32.848Z Session started.

## Verification
- 2026-07-26T09:59:07.628Z `桌面端 Pi + MiniMax 模型菜单交互`: 选择 MiniMax-M3 后触发器持续显示 MiniMax-M3；重新打开菜单仍保持显式选择；选择默认后触发器恢复默认；桌面窗口重启后正常渲染。

- 2026-07-26T09:58:55.173Z `npm run typecheck && npm run build`: TypeScript 编译通过；Vite 生产构建成功，保留仓库既有 chunk 与动态导入警告。
- 2026-07-26T09:58:42.502Z `node --import tsx --test src/lib/agent-session-preferences.test.ts`: 4 passed, 0 failed；覆盖自定义渠道模型目录引用稳定性。

## Completed

- 2026-07-26T09:59:17.368Z 修复 Pi 自定义渠道模型选择被恢复逻辑立即覆盖的问题：稳定渠道模型目录引用，保留默认与显式模型语义；专项测试、类型检查、生产构建和桌面端双向切换验收均完成。
