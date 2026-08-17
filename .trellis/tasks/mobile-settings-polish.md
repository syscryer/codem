# Task: 移动设置页与列表分隔优化

## Background

移动设置页在宽屏浏览器中被拉成过宽的表格式横栏，分组标题、长分割线和空白比例都不协调；任务列表同样使用贯穿内容区的分割线，长列表视觉过重。用户确认可以同步优化整体布局。

## Objective

重做移动设置页视觉层级并优化任务列表分隔线，保持现有功能、布局边界和桌面端不受影响。

## Scope

In scope:

- 移动首页在宽屏时的内容宽度与节奏。
- 任务/通知列表的行容器、间距与分隔方式。
- 设置页的信息结构、图标、分组容器、通知行和主题选择状态。
- 375px 与宽屏浏览器下的响应式视觉。

Out of scope:

- 不修改任务、通知、配对或主题切换的数据协议。
- 不修改桌面端页面、桌面端样式和共享会话渲染。

## Impact

- `src/mobile/MobileApp.tsx`
- `src/mobile/pages/SettingsPage.tsx`
- `src/mobile/prototype/prototype.css`
- `src/mobile/mobile.css`

## Acceptance Criteria

- [x] 宽屏移动页面不再横向拉满，首页和设置保持合适的阅读宽度。
- [x] 任务列表不再显示贯穿卡片的长分割线，行之间仍有明确层级。
- [x] 设置页使用统一图标、紧凑分组和清晰的尾部状态。
- [x] 浅色、跟随系统、深色选项有真实可见的选中态。
- [x] 375px 无横向溢出，触控区域不低于 44px。
- [x] 桌面样式产物保持不变，类型检查、移动专项测试和生产构建通过。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-20T18:09:04.172Z 移除主题分段控件的选中对勾，选中状态仅使用浮起背景、文字颜色和 aria-pressed，避免角标视觉偏心。

- 2026-07-20T18:06:09.235Z 移动端新增统一 --mobile-prototype-divider-width: 1px；统计分隔、项目/设置行、底栏、表单和选择面板均引用同一线宽，布局和间距保持不变。
- 2026-07-20T17:45:32.925Z 重做移动设置页为 540px inset grouped 布局：连接、权限、通知和外观使用统一图标行，主题具备真实选中态；移动首页宽屏收窄到 600px，任务/通知列表移除长分割线并改为独立间距行；原型改为加载真实 mobile.css。

- 2026-07-20T17:35:36.785Z Task created by Trellis automation.

## Verification Results

- 2026-07-20T18:11:15.670Z `git diff --check`: pass
- 2026-07-20T18:09:51.459Z `npm run build`: pass: mobile-u9SuhKYa.css; desktop styles-Ib9hzUXV.css unchanged

- 2026-07-20T18:08:36.098Z `npm run build`: pass: mobile-CZbx8p_9.css; desktop styles-Ib9hzUXV.css unchanged
- 2026-07-20T18:07:15.260Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 14 tests

- 2026-07-20T18:06:54.557Z `npm run typecheck`: pass
- 2026-07-20T17:47:29.848Z `git diff --check`: pass

- 2026-07-20T17:47:22.062Z `npm run build`: pass: mobile-BeU1DrKw.css; desktop styles-Ib9hzUXV.css unchanged
- 2026-07-20T17:47:11.850Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 14 tests

- 2026-07-20T17:47:01.345Z `npm run typecheck`: pass
- 2026-07-20T17:46:52.638Z `390px and 1024px browser visual QA`: pass: settings 362px/540px content widths; home shell 600px; no horizontal overflow; task row separators none; dark theme selected state verified

## Completion Summary

- 2026-07-20T18:11:22.917Z 移动端分割线统一为 1px，并移除主题选择对勾；选中状态继续由浮起背景和 aria-pressed 表达。类型检查、14 项专项测试和生产构建通过，桌面样式未变化。
- 2026-07-20T17:47:41.359Z 完成移动设置页和首页布局重做：设置页改为带图标的 inset grouped 卡片、主题真实选中态与紧凑隐私说明；移动首页宽屏限制 600px，任务/通知长分割线移除并改为独立间距行；原型复用真实移动样式。390px/1024px 深浅主题视觉验收、14 项专项测试、类型检查和生产构建通过，桌面样式未变化。

## Follow-ups

- 本轮不新增设置项；后续设置能力扩展时继续复用当前分组行组件与样式。
