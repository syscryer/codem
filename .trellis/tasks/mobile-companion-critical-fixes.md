# Task: 移动伴侣高优先级审查修复

## Background

未提交的移动伴侣实现经复核后确认两项高优先级问题：移动任务完成时通过 GET/PUT 整包回写线程历史，可能覆盖桌面端并发写入；任务与工作区 SSE 由每个连接独立高频轮询，并反复复制完整事件数组，长任务和多设备场景会放大 CPU、内存与内部 API 压力。

## Objective

消除移动历史整包回写的并发覆盖，并将移动 SSE 改为共享增量通知机制，不处理局域网安全及其他中低优先级问题

## Scope

In scope:

- 为桌面后端增加受 workspace 写锁保护的单轮历史合并接口。
- 移动伴侣完成任务时只提交待合并 turn，不再读取和覆盖整份 history。
- 任务 SSE 使用通知驱动的增量事件读取，不再每 100ms clone 全量事件。
- 工作区 runtime 状态由服务级共享观察器轮询并广播，不再按 SSE 连接重复请求。
- 补充定向 Rust 测试并运行前后端既有门禁。

Out of scope:

- 登录限流、TLS、监听地址、防火墙、Token 生命周期等局域网安全策略。
- fallbackTask、任务切换竞态、SSE 重新认证等中低优先级问题。
- 移动端视觉、路由和桌面 React 页面调整。

## Impact

- `src-tauri/src/backend.rs`：新增内部单轮历史合并路由和事务边界。
- `src-tauri/src/mobile_companion.rs`：持久化协议和 SSE 唤醒机制调整。
- 桌面端现有 `/api/threads/:id/history` GET/PUT 行为保持不变。

## Acceptance Criteria

- [ ] 移动端持久化一轮时不再执行 history GET/PUT 整包读改写。
- [ ] 单轮合并在同一 workspace 写锁内基于最新数据库历史执行。
- [ ] 任务 SSE 只克隆尚未发送的事件切片，空闲时由通知唤醒并保留心跳。
- [ ] 多个工作区 SSE 连接复用同一个 runtime 观察器。
- [ ] 桌面端现有历史读写、会话事件和前端行为不变。
- [ ] TypeScript、移动端定向测试、Rust mobile/backend 定向测试和格式检查通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion -- --nocapture`
- `cargo test --manifest-path src-tauri/Cargo.toml backend::tests -- --nocapture`
- `npm run typecheck`
- `node --import tsx --test src/mobile/**/*.test.ts src/mobile/*.test.ts src/lib/client-id.test.ts src/lib/agent-run-events.test.ts`
- `git diff --check`

## Implementation Record

- 2026-08-17T02:17:26.447Z 完成关键修复并按最多两台手机场景收口：移动 turn 使用 workspace 写锁内的单轮原子合并接口；任务 SSE 使用 watch 通知和增量事件切片，共享 runtime watcher。Agent Mux 以 bypassPermissions/max 完成只读复核，结论为没有高或中高问题；其报告的桌面陈旧全量 PUT 与 3 秒驻留窗口新 run 均为中风险，按本任务范围不继续修改。
- 2026-08-17T01:26:37.766Z 已实现第一版关键修复：移动 turn 改为调用桌面后端原子单轮合并接口；任务 SSE 改用 live revision 增量唤醒，共享 runtime signature watcher 替代每连接轮询。准备执行格式化和编译检查。

- 2026-08-17T01:18:20.426Z Task created by Trellis automation.

## Verification Results
- 2026-08-17T02:17:33.806Z `git diff --check`: pass (only existing CRLF conversion warnings)

- 2026-08-17T02:17:32.817Z `node --import tsx --test mobile/shared tests (50 passed)`: pass
- 2026-08-17T02:17:31.732Z `npm run typecheck`: pass

- 2026-08-17T02:17:30.658Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion -- --nocapture (45 passed)`: pass
- 2026-08-17T02:17:29.644Z `cargo test --manifest-path src-tauri/Cargo.toml backend::tests -- --nocapture (165 passed)`: pass

- 2026-08-17T02:17:28.567Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass
- 2026-08-17T02:17:27.486Z `cargo check --manifest-path src-tauri/Cargo.toml`: pass

## Completion Summary
- 2026-08-17T02:17:34.855Z 移动伴侣高/中高优先级修复完成：历史单轮合并消除移动 GET/PUT 覆盖窗口，SSE 改为共享通知驱动的增量流；Mux 最高权限复核无高或中高问题，全部定向门禁通过。

## Follow-ups

- 待补充。
