# Task: 优化 Agent 首条消息延迟

## Background

打开 Agent 新会话后第一次发送消息存在可感知延迟。当前通用 Agent 与 Claude 链路都会先等待线程创建接口返回，再把用户 turn 写入 timeline 并启动 Agent；这会把线程持久化耗时暴露为“发送没有反应”，并可能与 CLI 冷启动叠加。

## Objective

缩短打开 Agent 新会话后第一次发送消息的可感知等待，确保用户消息即时回显，并定位线程创建到首个运行事件的真实耗时

## Scope

In scope:

- 测量点击发送、用户消息回显、线程创建、运行请求和首个事件的时间顺序。
- 优化 Agent 新会话首次发送的即时回显和线程创建衔接。
- 保持失败时输入、附件和错误状态可恢复，不引入未持久化的伪会话。
- 同时覆盖 Claude Code 与通用 Agent 首发链路，保持两类 Agent 行为一致。
- 增加首发顺序和失败恢复的回归测试，并做真实页面验证。

Out of scope:

- 不修改普通聊天运行链路。
- 不通过隐藏状态或延迟展示掩盖 Agent CLI 的真实冷启动耗时。
- 不修改 Agent CLI 自身启动实现，除非测量证明后端存在可消除的串行准备步骤。

## Impact

- Frontend：只做真实页面计时和既有回归验证，不改变 Agent 或普通聊天状态模型。
- Backend：`backend.rs` 的线程 Provider 校验与 `agent_run.rs` 的命令解析缓存，不改变事件协议。
- Persistence：正式线程仍由后端创建并持久化，不改变 schema 或写入顺序。

## Acceptance Criteria

- [x] 正常应用启动后，点击发送到用户消息和运行状态可见控制在 100ms 内，不等待无关 Provider 探测或 Agent CLI 启动。
- [x] 线程创建成功后自动衔接到正确 Provider、权限、模型和思考级别的 Agent 运行。
- [x] 线程创建失败仍沿用现有可重试输入和真实错误流程，不留下不可访问的临时会话。
- [x] 附件、contentBlocks 和显示文本的首发路径保持不变且全量回归通过。
- [x] 已有会话发送、运行中队列和普通聊天行为不回归。
- [x] 自动化测试、类型检查、差异检查和真实浏览器首发验证通过。

## Verification Commands

- `node --import tsx --test src/**/*.test.ts`
- `npm run typecheck`
- `cargo test`
- `cargo fmt --check`
- `git diff --check`
- Playwright 真实页面首发计时与控制台检查

## Implementation Record
- 2026-07-15T16:08:13.029Z 已实现按所选 Provider 惰性校验命令；Claude 建线程不再探测通用 Agent。Grok、Codex、OpenCode 的已解析命令在 Provider 列表、模型目录、建线程和运行启动间共享 5 分钟正向缓存；强制刷新会清理旧缓存并重新探测。普通聊天和事件协议未改。

- 2026-07-15T15:54:27.013Z 真实基线：Claude 新线程 createThread 约 1.14s；Codex 新线程约 2.32s，用户消息只能在线程返回后出现。根因是 create_thread 无论所选 Provider 都同步探测 Grok/Codex/OpenCode；通用 Agent run 又重复解析命令。方案：Provider 按需校验，并复用进程级正向命令缓存。
- 2026-07-15T15:19:39.755Z 已确认当前首发顺序：新草稿先等待 createThread，随后才创建 timeline 用户 turn 并发起 Agent run；下一步通过真实页面区分线程创建等待与 CLI 冷启动。

- 2026-07-15T15:18:02.843Z Task created by Trellis automation.

## Verification Results
- 2026-07-15T16:08:42.235Z `Playwright 新线程首发实测`: Codex：createThread 2.32s→25ms，点击到用户消息/运行状态 2.43s→67ms，run 流建立 396ms→45ms；Claude：createThread 15ms，点击到用户消息 36ms。测试会话已全部清理，最终重载后一个轮询周期无新增控制台错误。

- 2026-07-15T16:08:34.182Z `node --import tsx --test src/**/*.test.ts；npm run typecheck；cargo fmt --check；git diff --check`: 通过：前端 487/487；TypeScript 无错误；Rust 格式通过；diff 无空白错误，仅既有 Windows LF/CRLF 提示。
- 2026-07-15T16:08:24.112Z `cargo test`: 通过：Rust lib 124 passed、1 个需真实 Grok 登录的 smoke ignored；桌面 main 9 passed；0 failed。

## Completion Summary
- 2026-07-15T16:09:50.559Z 已消除 Agent 新线程首发前的无关 CLI 探测：Provider 按需校验并共享 5 分钟命令缓存。Codex 用户消息/运行状态回显由约 2.43s 降至 67ms，Claude 为 36ms；前端 487/487、Rust 124+9、类型/格式/差异及浏览器回归通过。

## Follow-ups

- 模型真正开始输出仍受各 Agent CLI 和服务端推理时间影响；当前已有即时运行状态，只有后续实测仍存在无状态等待时才继续做 runtime 预热。
