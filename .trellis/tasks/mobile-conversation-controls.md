# Task: 移动会话模型与权限控件

## Background

移动会话 Composer 当前展示附件、模型和权限三个控制项，但附件与模型按钮被硬编码为禁用，权限只是静态文本。用户无法在非运行状态下为下一轮续聊选择模型或权限，界面表达与真实能力不一致。

## Objective

让移动会话 Composer 的模型和权限控件可交互，并把选项安全传入移动续聊接口；附件继续保持明确禁用

## Scope

In scope:

- 仅在移动会话详情页中启用模型与权限选择。
- 复用移动端统一的 `MobileSelect` 底部面板交互。
- 模型目录沿用移动 bootstrap、自定义渠道模型和现有动态模型目录接口。
- 将模型、推理强度、权限模式、渠道和空 `contentBlocks` 传入移动续聊接口。
- 移动后端仅在非运行 follow-up 启动新一轮时使用请求中的配置，缺省时回退到 thread 元数据。
- 运行中的 guide 不允许切换模型或权限，避免用户误以为热会话配置已改变。
- 附件继续保持明确禁用，等待统一 content blocks / 上传协议完整落地。
- 补充前端源代码约束测试和 Rust 请求覆盖逻辑测试。

Out of scope:

- 不实现附件上传、项目文件选择或图片发送。
- 不修改桌面端 Composer、路由、样式或发送机制。
- 不修改流式事件协议、会话历史结构和权限配对模型。
- 不允许移动端切换 Provider 或在运行中迁移热会话配置。

## Impact

- Frontend: `src/mobile/pages/TaskDetailPage.tsx`、`src/mobile/lib/mobile-api.ts`、移动端样式与测试。
- Backend: `src-tauri/src/mobile_companion.rs` 的移动续聊 payload 构造。
- 数据恢复：选择仅作用于下一次发送；发送后的 thread 元数据由既有桌面后端链路更新，页面刷新继续从 bootstrap/thread 恢复。
- Terminal event：沿用现有 `start_run` 与 guide 事件路径，不新增或修改 terminal event。

## Acceptance Criteria

- [x] 非运行会话的模型与权限控件可点击，并使用移动端底部选择面板。
- [x] 模型选项来自当前渠道静态模型或支持的动态模型目录；无目录时显示 Provider 默认。
- [x] 发送 follow-up 时，移动请求携带 model、reasoningEffort、permissionMode、channelId 与 contentBlocks。
- [x] 后端以经过现有运行链校验的请求值覆盖 thread 默认值，未传入时保持原行为。
- [x] 运行中模型与权限控件禁用，guide 仍只发送 prompt。
- [x] 附件控件保持禁用，并通过无障碍名称明确说明暂未开放。
- [x] 移动端 375px 宽度无横向溢出，触控区域不小于 44px。
- [x] 桌面入口与桌面样式不被修改。

## Verification Commands

- `npm run typecheck`
- `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_send_payload`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `git diff --check`

## Implementation Record

- 2026-07-20T11:56:32.547Z 补充 Composer 窄屏回归断言：工具栏 min-width 约束、模型 flex 收缩与所有控件 44px 触控区域均由测试锁定。浏览器当前未配对，因此未创建额外测试设备，真机发送复核留作后续。
- 2026-07-20T11:54:04.591Z 实现移动会话 Composer 的模型与权限底部选择器：复用 MobileSelect，渠道静态模型优先、支持的 Provider 使用动态目录；运行中锁定配置，附件保持禁用。移动 send 改为结构化请求，Rust 以请求配置优先、thread 元数据回退，guide 仍只转发 prompt。桌面入口与桌面样式未修改。

- 2026-07-20T11:19:33.130Z Task created by Trellis automation.

## Verification Results
- 2026-07-20T11:56:33.553Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 9 tests including 44px and narrow composer constraints

- 2026-07-20T11:54:22.223Z `git diff --check`: pass
- 2026-07-20T11:54:20.809Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass

- 2026-07-20T11:54:19.399Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_send_payload`: pass: 2 tests
- 2026-07-20T11:54:18.136Z `npm run build`: pass: desktop CSS styles-Ib9hzUXV.css unchanged; mobile CSS mobile-7yxVv18G.css

- 2026-07-20T11:54:16.860Z `node --test --experimental-strip-types src/mobile/mobile-conversation-reuse.test.ts`: pass: 9 tests
- 2026-07-20T11:54:15.304Z `npm run typecheck`: pass

## Completion Summary
- 2026-07-20T11:56:45.700Z 移动会话非运行状态的模型和权限控件已接入真实底部选择器与续聊请求；运行中保持锁定，附件保持明确禁用。后端支持请求配置覆盖并保留 thread 回退，测试、构建、格式和桌面样式隔离均通过。

## Follow-ups

- 附件入口待统一 content blocks、上传与历史脱敏协议完成后再开放。
- 浏览器当前未配对，本轮未创建额外测试设备；配对后再补一次真机点击与发送复核。
