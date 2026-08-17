# Task: 移动端原生风格视觉优化

## Background

当前移动端功能和页面结构已经可用，但视觉仍偏冷灰、卡片和边框过重，焦点态与状态色过于突出，与用户提供的 Apple 风格参考不一致。

## Objective

在保持现有移动端布局与功能不变的前提下，按用户提供的 Apple 风格参考优化任务、项目、通知、设置、新建和会话外壳视觉；移动样式独立，不能影响桌面端。

## Scope

In scope:

- 移动任务、项目、通知、设置、新建任务和会话外壳的颜色、字体层级、分隔线、圆角、阴影、焦点态和安全区适配。
- 以暖白背景、低对比度分区、轻量浮起容器和 iOS 风格列表行替换现有冷灰卡片感。
- 保持现有路由、组件结构、交互动作、聊天共享渲染和桌面端样式不变。

Out of scope:

- 不增加新的业务功能、导航入口、后端接口或移动数据协议。
- 不修改桌面端 `src/styles.css` 的视觉规则，不引入新 UI 依赖。

## Impact

- 仅影响 `src/mobile/prototype/prototype.css` 与 `src/mobile/mobile.css` 的移动端样式入口。
- 需要验证 375px/390px 移动宽度、深浅主题、焦点态和共享会话区域未出现横向溢出。

## Acceptance Criteria

- [x] 移动端浅色视觉接近用户参考：暖白底、低对比度分组、细分隔线、克制阴影和统一圆角。
- [x] 任务/项目/通知列表保持现有信息层级和点击行为，状态仍同时有图标、文字和颜色表达。
- [x] 设置和新建任务的分组行不再出现厚重卡片与突兀蓝色焦点框。
- [x] 会话消息和 Composer 仍复用现有桌面聊天机制，仅优化移动外壳与控件表面。
- [x] 375px 宽度无横向溢出；桌面端视觉产物无变化。
- [x] `npm run typecheck`、移动专项测试、生产构建和 `git diff --check` 通过。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-20T17:26:37.761Z 完成移动端原生风格第一轮视觉收口：暖白/深灰主题 token、轻量分区与阴影、设置整行分组、会话头部与 Composer 胶囊、底栏和焦点态统一；未修改桌面组件结构或桌面样式。

- 2026-07-20T15:53:44.883Z Task created by Trellis automation.

## Verification Results
- 2026-07-20T17:29:19.004Z `git diff --check`: pass

- 2026-07-20T17:29:11.624Z `npm run build`: pass: mobile-nRQwyNgW.css; desktop styles-Ib9hzUXV.css unchanged
- 2026-07-20T17:29:01.649Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 13 tests

- 2026-07-20T17:28:52.588Z `npm run typecheck`: pass
- 2026-07-20T17:27:38.934Z `375px/390px browser visual QA`: pass: task/settings/detail rendered; viewport and scrollWidth both 375px; composer stayed within safe bounds

## Completion Summary
- 2026-07-20T17:29:40.745Z 完成移动端 Apple 原生风格视觉优化：保留现有布局与业务机制，统一暖白/深色主题、分组列表、状态色、头部、底栏、Composer、表单、连接页和选择面板；移除突兀焦点框。375px/390px 视觉验收、13 项移动回归测试、类型检查和生产构建均通过，桌面样式产物保持不变。

## Follow-ups

- 如后续需要完全复刻参考图的侧栏/会话首页信息架构，应另建任务，不在本轮改变当前移动端布局。
