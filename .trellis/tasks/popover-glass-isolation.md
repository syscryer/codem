# Task: 修复右键菜单玻璃材质

## Background

桌面根节点 `.codex-desktop::before` 已负责整窗材质模糊，`PopoverPortal` 又把菜单挂载在该根节点内部。Chromium/WebView2 对嵌套 `backdrop-filter` 无法再次采样侧栏内容，导致菜单虽然声明了模糊，实际仍像透明叠层，底下文字和图标可直接辨认。此前通过提高菜单底色透明度补偿，既没有解决采样层级，也容易在调整全局材质时影响对话框。

## Objective

让弹层获得独立可读的玻璃效果，同时不改变对话框和根窗口材质透明度

## Scope

In scope:

- 将 Popover 菜单挂载到 `.codex-desktop` 之外的 body 级独立宿主。
- 将当前主题、平台、窗口材质、密度及计算后的 CSS 变量同步到菜单宿主。
- 让现有菜单主题样式同时适用于应用根节点和独立宿主。
- 增加弹层挂载层级、主题同步及对话框样式隔离测试。

Out of scope:

- 不调整根窗口材质参数。
- 不调整 `.dialog-backdrop`、`.dialog-card` 或对话框挂载方式。
- 不改变菜单内容、命令和右键目标选中逻辑。

## Impact

- 所有复用 `PopoverPortal` 的菜单和下拉弹层获得独立 backdrop 采样层。
- 菜单在浅色、深色、系统主题和不同密度下继续继承应用主题变量。
- 对话框保持现有实体背景和遮罩模糊，不受菜单材质修改影响。

## Acceptance Criteria

- [x] 打开侧栏项目或会话右键菜单时，portal 的直接父节点是 `document.body`，不再位于 `.codex-desktop` 内。
- [x] 菜单宿主同步根节点的主题数据属性和 CSS 自定义变量。
- [x] 菜单底下的侧栏文字被局部模糊，不能以清晰文字直接穿透。
- [x] 右键未激活会话不会切换当前会话，临时目标高亮保持中性灰。
- [x] 从右键菜单打开重命名对话框后，对话框仍保留原有实体背景和遮罩模糊。
- [x] 类型检查、定向测试和 diff 格式检查通过。

## Verification Commands

- `npx.cmd tsx --test src/lib/window-material.test.ts src/lib/popover-portal.test.ts src/lib/workspace-pinning.test.ts`
- `npm run typecheck`
- `git diff --check`
- Playwright：右键未激活会话，检查 portal 父节点、计算样式与截图；打开重命名对话框检查计算样式。

## Implementation Record
- 2026-07-15T13:21:44.686Z 确认根因是 PopoverPortal 位于整窗 backdrop-filter 内，已改为 body 级独立宿主并同步主题数据属性、CSS 变量和系统深浅色变化；对话框挂载与样式保持不变。

- 2026-07-15T12:56:34.603Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T13:21:47.767Z `Playwright 菜单与对话框回归`: 通过：portal 直属 BODY 且不在 .codex-desktop 内；浅色与暗色主题变量同步；菜单 blur(34px) 生效；未激活会话右键不切换当前会话；重命名对话框保持不透明背景和 blur(4px) 遮罩；控制台 0 error。
- 2026-07-15T13:21:47.041Z `git diff --check`: 通过：无空白错误，仅有工作区既有 LF/CRLF 提示。

- 2026-07-15T13:21:46.210Z `npm run typecheck`: 通过：TypeScript 项目引用检查无错误。
- 2026-07-15T13:21:45.451Z `相关弹层与样式测试`: 通过：119/119，包含 popover 宿主、窗口材质、对话框隔离、侧栏和工作台相关守门测试。

## Completion Summary
- 2026-07-15T13:22:28.520Z 修复 Popover 嵌套整窗 backdrop-filter 导致菜单仅透明不磨砂的问题；新增 body 级主题宿主、浅深色同步与隔离测试，并验证对话框材质未受影响。

## Follow-ups

- 无。
