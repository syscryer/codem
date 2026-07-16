# Session Record: 修复全局 Tooltip 定位偏移

- Session: session-20260715-120934-tuvr
- Started: 2026-07-15T12:09:34.903Z
- Task: .trellis/tasks/global-tooltip-positioning.md

## Notes

- 2026-07-15T12:19:05.647Z 已完成全局 TooltipLayer 修复：鼠标 pointerover 记录 clientX 作为横向锚点，focusin 使用元素中心；滚动和 resize 重新测量时保留触发锚点；视口夹紧逻辑保持不变。新增纯函数测试覆盖宽元素、键盘居中和目标边界。
- 2026-07-15T12:10:51.089Z 确认根因：全局 TooltipLayer 使用目标元素包围盒中心定位；ProviderFact 的 title 位于整行宽且右对齐的 dd 上，因此 tooltip 出现在行中间。采用鼠标 clientX 锚定、键盘焦点居中、滚动时保留锚点的统一修复。

- 2026-07-15T12:09:34.907Z Session started.

## Verification

- 2026-07-15T12:19:34.363Z `Playwright http://127.0.0.1:5174 Agent 与模型设置页`: 通过：OpenCode 更新命令目标中心 931px、文字/鼠标中心 1134px、tooltip 中心 1133.7px；普通刷新按钮与 tooltip 中心误差小于 0.2px，键盘聚焦保持居中；控制台 0 error。
- 2026-07-15T12:19:18.947Z `node --import tsx --test src/components/TooltipLayer.test.ts；npm run typecheck；git diff --check`: 通过：Tooltip 横向锚点测试 3/3；TypeScript 类型检查通过；diff check 无空白错误，仅既有 Windows LF/CRLF 提示。

## Completed

- 2026-07-15T12:19:48.599Z 修复全局 tooltip 在宽目标上远离鼠标的问题：鼠标触发按实际指针横坐标定位，键盘触发保持元素中心，滚动更新和视口夹紧保持稳定；单元测试与真实设置页量测均通过。
