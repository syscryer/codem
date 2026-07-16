# Session Record: 优化 Agent 首条消息延迟

- Session: session-20260715-151802-4ykh
- Started: 2026-07-15T15:18:02.842Z
- Task: .trellis/tasks/agent-first-message-latency.md

## Notes
- 2026-07-15T16:08:13.029Z 已实现按所选 Provider 惰性校验命令；Claude 建线程不再探测通用 Agent。Grok、Codex、OpenCode 的已解析命令在 Provider 列表、模型目录、建线程和运行启动间共享 5 分钟正向缓存；强制刷新会清理旧缓存并重新探测。普通聊天和事件协议未改。

- 2026-07-15T15:54:27.013Z 真实基线：Claude 新线程 createThread 约 1.14s；Codex 新线程约 2.32s，用户消息只能在线程返回后出现。根因是 create_thread 无论所选 Provider 都同步探测 Grok/Codex/OpenCode；通用 Agent run 又重复解析命令。方案：Provider 按需校验，并复用进程级正向命令缓存。
- 2026-07-15T15:19:39.755Z 已确认当前首发顺序：新草稿先等待 createThread，随后才创建 timeline 用户 turn 并发起 Agent run；下一步通过真实页面区分线程创建等待与 CLI 冷启动。

- 2026-07-15T15:18:02.845Z Session started.

## Verification
- 2026-07-15T16:08:42.235Z `Playwright 新线程首发实测`: Codex：createThread 2.32s→25ms，点击到用户消息/运行状态 2.43s→67ms，run 流建立 396ms→45ms；Claude：createThread 15ms，点击到用户消息 36ms。测试会话已全部清理，最终重载后一个轮询周期无新增控制台错误。

- 2026-07-15T16:08:34.182Z `node --import tsx --test src/**/*.test.ts；npm run typecheck；cargo fmt --check；git diff --check`: 通过：前端 487/487；TypeScript 无错误；Rust 格式通过；diff 无空白错误，仅既有 Windows LF/CRLF 提示。
- 2026-07-15T16:08:24.112Z `cargo test`: 通过：Rust lib 124 passed、1 个需真实 Grok 登录的 smoke ignored；桌面 main 9 passed；0 failed。

## Completed

- 2026-07-15T16:09:50.559Z 已消除 Agent 新线程首发前的无关 CLI 探测：Provider 按需校验并共享 5 分钟命令缓存。Codex 用户消息/运行状态回显由约 2.43s 降至 67ms，Claude 为 36ms；前端 487/487、Rust 124+9、类型/格式/差异及浏览器回归通过。
