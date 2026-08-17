# Task: 移动端自定义选择器

## Background

移动新建任务页当前直接使用原生 `select`。在桌面浏览器和部分 Android WebView 中，展开层由浏览器绘制，会出现宽大的灰色列表、错位覆盖和与 CodeM 移动视觉完全不一致的问题，且无法统一控制安全区、圆角和动效。

## Objective

将移动新建任务页的原生 select 替换为移动专属底部选择面板，保持桌面端零影响

## Scope

In scope:

- 新增移动专属选择器组件，使用底部选择面板展示选项。
- 替换新建任务页的项目、Agent、渠道、模型、推理强度和权限模式六个原生选择器。
- 支持当前项轻量背景提示、点击遮罩关闭、Escape/返回键关闭、Tab 焦点约束和焦点恢复。
- 覆盖 375px、深浅主题变量、安全区和 reduced motion。

Out of scope:

- 不修改桌面端选择器、桌面样式或桌面路由。
- 不引入新的全局 UI 依赖。
- 不改变任务创建参数和模型/渠道数据流。

## Impact

- `src/mobile/components/MobileSelect.tsx`
- `src/mobile/pages/NewTaskPage.tsx`
- `src/mobile/mobile.css`
- `src/mobile/mobile-conversation-reuse.test.ts`

## Acceptance Criteria

- [ ] 新建任务页不再渲染原生 `select`。
- [ ] 六个选择项使用统一底部面板，当前项以轻量背景和字重表达，不显示额外对勾。
- [ ] 面板不会被页面滚动容器裁切，375px 下无横向溢出。
- [ ] 点击遮罩、取消和 Escape 均可关闭，关闭后焦点回到触发器。
- [ ] 键盘 Tab 不会离开打开的面板。
- [ ] 所有改动仅进入移动资源，桌面 CSS 哈希不变化。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `git diff --check`
- 375px HTTPS Chrome 真页操作验证。

## Implementation Record
- 2026-07-20T08:35:37.617Z 将新建任务六个原生 select 替换为移动专属 MobileSelect 底部面板；通过 portal 避免 overflow 裁切，提供当前项勾选、遮罩/取消/Escape/浏览器返回关闭、Tab 焦点约束与触发器焦点恢复；不改变选择值和任务提交数据流。

- 2026-07-20T08:21:50.421Z Task created by Trellis automation.

## Verification Results
- 2026-07-20T08:36:46.534Z `375px/1150px HTTPS Chrome 真页验证`: 通过；375px 底部面板无溢出，1150px 居中 560px，选择/取消/Escape/浏览器返回/焦点恢复正常

- 2026-07-20T08:36:45.175Z `git diff --check`: 通过，仅既有 CRLF 警告
- 2026-07-20T08:36:43.833Z `npm run build`: 通过；桌面 styles-Ib9hzUXV.css 未变化，移动资源包含 MobileSelect

- 2026-07-20T08:36:42.647Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 7 passed
- 2026-07-20T08:36:41.592Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-20T09:43:24.289Z 移动新建任务页六个原生 select 已替换为移动专属底部选择面板；375px 使用贴底样式，宽屏收敛为 560px 居中面板，支持选中勾选、遮罩/取消/Escape/系统返回关闭、焦点约束与恢复；真实 HTTPS 页面和构建验证通过，桌面 CSS 未变化。

## Follow-ups

- 若后续项目或模型数量显著增加，再为同一组件增加搜索模式；本次保持轻量，不引入搜索输入。
- 2026-07-21 根据真机预览反馈取消宽屏居中弹窗分支；移动路由在窄屏、宽屏和横屏下都保持贴底 Sheet，选中项不再显示对勾。
- 2026-07-21 最终验证：`npm run typecheck`、14 项移动专项测试、`npm run build` 和 `git diff --check` 通过；真实 HTTPS 页面在 812x790 与 390x844 下均贴底、无横向溢出，选中项无 SVG 对勾和突兀焦点边框，桌面 CSS 仍为 `styles-Ib9hzUXV.css`。
