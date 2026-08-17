# Task: 移动任务更多操作菜单

## Background

移动会话详情页右上角的“更多操作”按钮当前没有点击处理，仅展示图标。桌面端菜单包含置顶、重命名、复制会话 ID 和删除，但移动设备权限模型只有 view/send/stop/approve，不能绕过移动 API 边界直接调用桌面管理接口。

## Objective

补全移动会话详情页空置的更多操作按钮，提供安全的刷新与复制操作，不扩大移动 API 权限边界

## Scope

In scope:

- 为非运行状态的更多按钮接入移动端底部 Action Sheet。
- 提供刷新会话、复制无查询参数的任务链接、复制任务 ID 三项安全操作。
- 支持遮罩、取消、Escape、系统返回关闭，约束键盘焦点并在关闭后恢复到触发按钮。
- 复制或刷新成功后显示轻量状态提示，失败复用现有错误提示。
- 仅修改移动端组件、样式和专项测试。

Out of scope:

- 不新增或修改移动 API。
- 不实现置顶、重命名、删除；这些动作需要单独设计移动端 manage 权限和审计边界。
- 不修改桌面端会话菜单、桌面样式和桌面路由。

## Impact

- `src/mobile/components/MobileActionSheet.tsx`
- `src/mobile/pages/TaskDetailPage.tsx`
- `src/mobile/mobile.css`
- `src/mobile/mobile-conversation-reuse.test.ts`

## Acceptance Criteria

- [x] 更多按钮具有真实点击、展开和关闭行为，不再是空按钮。
- [x] 面板始终贴底，触控区域不小于 44px，375px 下无横向溢出。
- [x] 刷新会话重新加载 thread 与 workspace 状态。
- [x] 复制链接不包含当前 URL 的查询参数或配对信息。
- [x] 支持遮罩、取消、Escape、系统返回和焦点恢复。
- [x] 深浅主题和 reduced motion 可用。
- [x] 桌面入口和桌面 CSS 不变化。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `git diff --check`
- 真实 HTTPS 页面在 390px 和宽屏视口下点击验证。

## Implementation Record

- 2026-07-21T15:31:02.644Z 真实 HTTPS 移动页面验收补充：调整 Action Sheet 为先启动并等待操作完成后再关闭，保留移动浏览器剪贴板用户手势和刷新/复制反馈；复制得到无查询参数任务链接，刷新提示、Escape、系统返回、焦点恢复均通过。
- 2026-07-21T11:06:14.021Z 补全移动任务详情更多操作：新增可访问的贴底 MobileActionSheet，提供刷新会话、复制无查询参数任务链接、复制任务 ID；支持遮罩、取消、Escape、系统返回和焦点恢复，不新增移动 API 或桌面改动。

- 2026-07-21T11:01:14.216Z Task created by Trellis automation.

## Verification Results
- 2026-07-21T15:31:09.711Z `HTTPS 真实页面 375x812 与 390x844 交互验收`: pass

- 2026-07-21T15:31:08.233Z `git diff --check`: pass
- 2026-07-21T15:31:06.690Z `npm run build`: pass

- 2026-07-21T15:31:05.200Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass
- 2026-07-21T15:31:03.742Z `npm run typecheck`: pass

## Completion Summary
- 2026-07-21T15:31:55.825Z 移动任务更多操作菜单已完成：接入安全 Action Sheet，刷新、复制链接和复制 ID 可用；真实 HTTPS 页面验证复制提示与无查询参数链接、刷新同步、Escape/系统返回、焦点恢复以及 375px 无溢出，未修改桌面入口与权限边界。

## Follow-ups

- 若后续需要置顶、重命名或删除，先扩展设备 manage 权限、移动 API 和审计测试，再在此菜单增加入口。
