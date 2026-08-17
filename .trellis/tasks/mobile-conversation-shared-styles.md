# Task: 移动会话共享样式恢复

## Background

真实移动会话已经复用桌面 `ConversationPane` 和 `ConversationTurn`，但移动入口只加载 `src/mobile/mobile.css`，没有加载这些共享组件依赖的 `src/styles.css`。因此会话正文、工具调用和元信息退化为浏览器默认样式，而移动头部与 Composer 仍有样式。

## Objective

让真实移动会话完整复用桌面对话样式，同时保持移动外壳和响应式边界

## Scope

In scope:

- 仅在移动专属样式入口中加载现有桌面对话基础样式。
- 保证移动覆盖样式后加载，继续控制移动外壳、字号、安全区和 Composer。
- 增加入口隔离测试，防止修复改变桌面路由的样式加载逻辑。
- 审计移动列表、导航、设置、审批、用户输入和新建任务的焦点态，避免边框被裁切或形成双重描边。
- 移动新建任务对不支持动态模型目录的 Provider 使用默认模型，并复用自定义渠道模型。
- 移动网关解包上游 JSON 错误，避免界面展示序列化对象。

Out of scope:

- 不修改 `src/styles.css` 中的桌面视觉规则。
- 不修改桌面组件 JSX、桌面路由、桌面状态和会话机制。
- 不重新设计聊天内容；继续以桌面端当前样式为准。

## Impact

- `src/mobile/mobile.css`
- `src/mobile/mobile-conversation-reuse.test.ts`
- `src/mobile/pages/NewTaskPage.tsx`
- `src-tauri/src/mobile_companion.rs`

## Acceptance Criteria

- [ ] 移动会话加载桌面 `ConversationPane` 所需基础样式。
- [ ] 移动覆盖层在共享样式之后生效。
- [ ] 桌面入口仍只走原有 `src/styles.css` 和 `App` 分支。
- [ ] 移动会话在 375px 下无横向溢出，Composer 不遮挡正文。
- [ ] 桌面端代码和视觉规则文件没有被改动。
- [ ] 移动端所有主要交互控件保持可见但克制的键盘焦点，触控时无默认高亮框。
- [ ] Claude Code 默认模型不再触发动态目录错误，自定义渠道可直接使用已配置模型。
- [ ] 移动 API 错误显示自然文本，不显示原始 JSON。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `git diff --check`
- 真实移动详情页浏览器验证。

## Implementation Record
- 2026-07-20T06:56:57.943Z 完成移动端全局焦点审计：新建任务、选择行、任务列表、设置行、底栏、真实会话 Composer、审批与用户输入控件均由移动容器承载克制焦点；提高移动入口选择器特异性以隔离桌面全局焦点环；Claude Code 默认模式不再请求动态模型目录，自定义渠道复用已配置模型；移动网关解包上游 JSON 错误。

- 2026-07-20T05:46:02.814Z 移动 Composer 焦点状态改为由外层 focus-within 统一承载，移除 textarea 内部 3px 描边；使用低透明度边框和 2px 外层光晕，保持键盘焦点可见且不影响桌面端
- 2026-07-20T03:35:46.849Z 真实移动会话复用了 ConversationPane 但移动入口未加载 src/styles.css，导致会话内容退化为浏览器默认样式；本轮只在 src/mobile/mobile.css 内引入共享基础样式，移动覆盖层随后生效，未修改桌面路由和桌面样式文件

- 2026-07-20T03:29:54.593Z Task created by Trellis automation.

## Verification Results

- 2026-07-20T06:57:22.931Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && git diff --check`: 通过，仅既有 CRLF 警告
- 2026-07-20T06:57:21.589Z `375px Chrome 真页验证`: 通过；scrollWidth=innerWidth=375；textarea 自身无 outline/box-shadow；选择、任务、设置、会话 Composer 焦点均克制；Claude Code 无动态目录红错

- 2026-07-20T06:57:20.226Z `npm run build`: 通过；桌面 styles-Ib9hzUXV.css 未变化，移动资源 mobile-CBz0n63w.css
- 2026-07-20T06:57:19.033Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_proxy_unwraps_upstream_json_errors`: 1 passed

- 2026-07-20T06:57:17.754Z `node --test --experimental-strip-types src/mobile/mobile-startup-cache.test.ts`: 4 passed
- 2026-07-20T06:57:16.473Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 6 passed，覆盖移动入口隔离、Composer/表单/列表/设置/审批焦点与模型目录策略

- 2026-07-20T06:57:15.406Z `npm run typecheck`: 通过
- 2026-07-20T05:46:06.601Z `移动网关焦点 CSS`: mobile-mxf4XzSB.css 返回 200 text/css，包含 focus-within 且 textarea outline:none

- 2026-07-20T05:46:05.400Z `npm run build`: 通过；桌面 styles-Ib9hzUXV.css 保持不变，移动资源更新为 mobile-mxf4XzSB.css
- 2026-07-20T05:46:03.956Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 4 passed；包含 Composer 外层焦点与 textarea 无描边回归

- 2026-07-20T03:35:52.023Z `移动网关 CSS 产物`: mobile-D-OJBLTw.css 返回 200 text/css，包含 conversation-shell、tool-step、mobile-conversation-region
- 2026-07-20T03:35:50.650Z `npm run build`: 通过；桌面 styles-Ib9hzUXV.css 哈希保持不变，新增移动 mobile-D-OJBLTw.css 包含共享会话规则和移动覆盖

- 2026-07-20T03:35:49.347Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: 3 passed；覆盖共享样式加载顺序和桌面入口隔离
- 2026-07-20T03:35:47.940Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-20T06:58:11.904Z 移动端全局焦点态与模型目录体验完成：移动列表、设置、选择器、任务描述、会话 Composer、审批/用户输入统一隔离桌面焦点规则；Claude Code 默认模式不再显示动态目录错误；移动网关错误文本已解包；375px HTTPS Chrome 真页验证通过，桌面 CSS 产物未变化。

## Follow-ups

- 后续若桌面全局样式体积成为移动首屏瓶颈，再按组件依赖抽取共享 conversation stylesheet；本次不复制或拆分大段 CSS，避免桌面与移动样式分叉。
