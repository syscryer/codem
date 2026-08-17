# Task: 移动端实时对话与视觉重做

## Background

待补充背景。

## Objective

让移动伴侣真实流式展示 Agent 输出，并按 MIT 项目的成熟移动聊天交互重做详情页视觉，不复制受限代码

## Scope

In scope:

- 待补充。

Out of scope:

- 待补充。

## Impact

- 待补充。

## Acceptance Criteria

- [ ] 待补充。

## Verification Commands

- 待补充。

## Implementation Record

- 2026-07-19T05:42:04.052Z 补齐桌面端已启动任务的实时接入：移动 SSE 发现 active run 后在 Rust 内部中继桌面事件；SSE 输出经过 sanitize_live_event，只发文本、公开 Thinking、工具摘要、审批/提问和终态，不泄露原始工具参数。
- 2026-07-19T05:36:21.818Z 按 MIT 许可的 NextChat 交互模式重做移动会话详情；MindFS 仅作行为参考，未复制 AGPL 代码。新增按任务 SSE，前端以事件触发增量刷新并保留 6 秒轮询兜底；流式文本和 Thinking 按事件顺序合并。

- 2026-07-19T05:22:11.121Z Task created by Trellis automation.

## Verification Results
- 2026-07-19T05:42:06.351Z `真实移动任务 STREAM_OK + 375px 浏览器回归`: 通过：创建任务时显示运行中/实时，完成后收到 STREAM_OK；详情页和首页无横向溢出，浏览器无 error/warning 日志

- 2026-07-19T05:42:05.078Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 通过：9 个移动伴侣测试全部通过，含 SSE 脱敏测试
- 2026-07-19T05:36:25.407Z `真实移动任务：STREAM_OK`: 通过：375px 浏览器创建任务后显示运行中/实时，随后收到 STREAM_OK 并进入完成历史；页面无横向溢出

- 2026-07-19T05:36:24.034Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 通过：8 个移动伴侣测试全部通过，含流式事件顺序测试
- 2026-07-19T05:36:22.845Z `npm run typecheck && npm run build`: 通过：前端类型检查和生产静态产物构建完成

## Completion Summary
- 2026-07-19T05:42:07.679Z 移动伴侣完成第一轮实时聊天与视觉重做：新增按任务 SSE、桌面 active run 中继、流式文本/Thinking 事件顺序与脱敏；详情页改为 Apple 轻玻璃单栏聊天界面，Composer、状态头、审批/提问卡片和滚动行为统一。参考 MIT NextChat 交互，不复制 AGPL MindFS 代码。

## Follow-ups

- 待补充。
