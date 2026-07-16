# Task: 修复全局 Tooltip 定位偏移

## Background

全局 `TooltipLayer` 会把原生 `title` 统一转换为应用内浮层。当前横向位置始终使用目标元素包围盒中心；当 `title` 挂在整行、宽列表项或右对齐容器上时，用户实际悬停在右侧文本，tooltip 却出现在整行中间，视觉上偏离很远。

## Objective

让鼠标触发的全局 Tooltip 靠近实际指针位置，同时保持键盘聚焦、滚动更新和视口边缘约束正确

## Scope

In scope:

- 鼠标触发 tooltip 时使用实际指针横坐标作为锚点。
- 键盘聚焦触发时继续使用目标元素中心，保持可访问性。
- 滚动和窗口尺寸变化后保留当前触发方式与锚点语义。
- 保持视口边缘夹紧，避免 tooltip 溢出窗口。
- 补充横向锚点计算回归测试，并用真实设置页验证宽元素。

Out of scope:

- 不修改各业务组件的 `title` 或 tooltip 文案。
- 不调整 tooltip 颜色、字号、圆角和阴影。
- 不重做图表内部专用 tooltip。

## Impact

- Frontend: `src/components/TooltipLayer.tsx`
- Tests: `src/components/TooltipLayer.test.ts`
- Persistence / Backend: 无影响

## Acceptance Criteria

- [x] 宽元素右侧文本的 tooltip 显示在鼠标附近，不再出现在元素中心。
- [x] 普通按钮和图标 tooltip 保持正确。
- [x] 键盘聚焦 tooltip 仍以元素中心定位。
- [x] tooltip 在视口左右边缘不会溢出。
- [x] 滚动和窗口尺寸变化后定位保持稳定。
- [x] 定向测试、类型检查、diff check 和真实浏览器验收通过。

## Verification Commands

- `node --import tsx --test src/components/TooltipLayer.test.ts`
- `npm run typecheck`
- `git diff --check`
- Playwright 验证 Agent 与模型设置页的宽命令行 tooltip 和普通图标 tooltip。

## Implementation Record

- 2026-07-15T12:19:05.647Z 已完成全局 TooltipLayer 修复：鼠标 pointerover 记录 clientX 作为横向锚点，focusin 使用元素中心；滚动和 resize 重新测量时保留触发锚点；视口夹紧逻辑保持不变。新增纯函数测试覆盖宽元素、键盘居中和目标边界。
- 2026-07-15T12:10:51.089Z 确认根因：全局 TooltipLayer 使用目标元素包围盒中心定位；ProviderFact 的 title 位于整行宽且右对齐的 dd 上，因此 tooltip 出现在行中间。采用鼠标 clientX 锚定、键盘焦点居中、滚动时保留锚点的统一修复。

- 2026-07-15T12:09:34.905Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T12:19:34.363Z `Playwright http://127.0.0.1:5174 Agent 与模型设置页`: 通过：OpenCode 更新命令目标中心 931px、文字/鼠标中心 1134px、tooltip 中心 1133.7px；普通刷新按钮与 tooltip 中心误差小于 0.2px，键盘聚焦保持居中；控制台 0 error。
- 2026-07-15T12:19:18.947Z `node --import tsx --test src/components/TooltipLayer.test.ts；npm run typecheck；git diff --check`: 通过：Tooltip 横向锚点测试 3/3；TypeScript 类型检查通过；diff check 无空白错误，仅既有 Windows LF/CRLF 提示。

## Completion Summary
- 2026-07-15T12:19:48.599Z 修复全局 tooltip 在宽目标上远离鼠标的问题：鼠标触发按实际指针横坐标定位，键盘触发保持元素中心，滚动更新和视口夹紧保持稳定；单元测试与真实设置页量测均通过。

## Follow-ups

- 图表内部专用 tooltip 继续由对应图表组件独立管理。
