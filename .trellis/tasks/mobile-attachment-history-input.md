# Task: 优化移动附件历史、发送反馈与键盘发送

## Background

移动端图片虽然能作为 content block 发送给模型，但历史只保留文件名摘要，因此刷新后无法显示缩略图。发送请求需要等待 Agent 上游启动后才清空输入并刷新会话，手机上会感觉按钮反应迟缓；移动 textarea 也只支持 Ctrl/Cmd+Enter，手机输入法的完成键不能发送。

## Objective

让移动端历史图片可安全预览，发送操作即时反馈，并支持手机输入法完成键发送，不改变桌面端行为

## Scope

In scope:

- 手机上传图片落到当前项目 `.codem-attachments`，历史仅保留不透明预览 ID。
- 增加需要移动设备登录和 view 权限的历史图片预览接口。
- 移动会话复用共享对话组件展示缩略图和全屏预览。
- 发送后立即插入本地 pending 回合并清空 Composer，失败时恢复输入和附件。
- textarea 使用 `enterKeyHint=send`；非组合输入状态下 Enter/手机完成键发送，Shift+Enter 换行。

Out of scope:

- 不修改桌面端页面、桌面 Composer 行为或桌面图片预览路径。
- 不在历史中保存 base64、电脑绝对路径或图片正文。
- 不回填修复前已经丢失原始内容的旧图片消息。
- 不实现附件清理器或云端附件同步。

## Impact

- Backend: `src-tauri/src/mobile_companion.rs` 的移动附件落盘、摘要和受权预览。
- Frontend: `src/mobile/pages/TaskDetailPage.tsx`、`src/mobile/hooks/useMobileThread.ts` 的移动交互；共享会话组件仅增加 opt-in 的 mobile preview scope。
- Types: `InputContentBlockSummary.image` 增加可选 `previewId`，桌面数据不提供该字段时行为不变。

## Acceptance Criteria

- [ ] 新发送的移动图片在运行中和刷新后的历史中均显示缩略图。
- [ ] 点击历史缩略图可以打开现有图片预览弹层。
- [ ] 未登录、无 view 权限、伪造 ID 或非项目附件文件不能读取。
- [ ] 移动历史响应不包含 base64 或电脑绝对路径。
- [ ] 点击发送后立即看到 pending 用户消息并清空输入框，失败时内容可恢复。
- [ ] 手机输入法完成键可发送，Shift+Enter 仍可换行，IME 组合输入期间不误发。
- [ ] 桌面端页面与输入行为不变。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`
- `npm run typecheck`
- `node --import tsx --test src/mobile/*.test.ts src/lib/authenticated-image.test.ts`
- `npm run build`
- `git diff --check`
- 重启桌面开发模式后，用移动 API 和浏览器验证图片发送、历史预览、认证边界和键盘发送。

## Implementation Record
- 2026-08-16T05:06:49.773Z 完成移动图片落盘与受权预览：图片写入当前项目 .codem-attachments，历史仅返回 UUID previewId；新增认证预览接口并限制 view 权限、文件类型与 canonical 项目目录。前端仅在 attachmentPreviewScope=mobile 时使用移动预览地址，桌面默认行为不变。移动 Composer 增加 optimistic pending、失败恢复、enterKeyHint=send、Enter 发送、Shift+Enter 换行和 IME 保护。375x812 浏览器实测历史缩略图与点击预览正常，无横向溢出、无控制台错误；Enter 事件约 71ms 接收。旧历史中已丢失原始图片的消息无法回填。

- 2026-08-16T04:14:40.056Z Task created by Trellis automation.

## Verification Results
- 2026-08-16T05:07:06.225Z `375x812 browser verification: authenticated history thumbnail, preview dialog, enterKeyHint=send, Shift+Enter newline, Enter dispatch, no horizontal overflow or console errors`: pass

- 2026-08-16T05:07:05.049Z `git diff --check`: pass
- 2026-08-16T05:07:03.881Z `npm run build`: pass

- 2026-08-16T05:07:02.703Z `node --import tsx --test src/mobile/*.test.ts src/lib/authenticated-image.test.ts`: pass: 33 passed, 0 failed
- 2026-08-16T05:07:01.538Z `npm run typecheck`: pass

- 2026-08-16T05:07:00.390Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`: pass: 42 passed, 0 failed
- 2026-08-16T05:06:59.295Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass

## Completion Summary
- 2026-08-16T05:07:28.255Z 移动图片历史预览、发送即时反馈和手机键盘发送已完成：新图片可在刷新后的历史中认证预览，发送立即进入 pending 且失败恢复输入，Enter/手机完成键发送、Shift+Enter 换行；桌面端默认行为保持不变。自动化与 375px 浏览器验收均通过。

## Follow-ups

- 待补充。
