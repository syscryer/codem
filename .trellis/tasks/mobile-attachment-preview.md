# Task: 修复移动端图片附件预览

## Background

移动端选择图片后，待发送缩略图会被移动网关 CSP 拦截；常见手机照片经过 base64 编码后还会超过 Axum 默认 2MB 请求体限制。较小图片虽然能被模型接收，但移动中继没有把附件摘要投影到实时回合和历史，纯图片用户消息因此显示为空。

## Objective

让手机端新附件与历史图片使用可访问的安全预览，不影响桌面端附件机制

## Scope Update

移动端附件发送使用 base64 content blocks；手机照片超过默认 Axum 2MB 请求体后会被网关直接返回 413。因此同步提高移动网关的认证请求体上限到 16MB，覆盖常见手机图片并保持桌面端路由和附件协议不变。

## Scope

In scope:

- 允许移动页面显示本地 `blob:` 图片预览。
- 将移动 API 请求体上限提高到有明确边界的 16MB。
- 在移动实时回合与历史中保留安全的用户附件摘要。
- 纯图片回合可以持久化并在刷新后恢复。
- 保证附件摘要不包含 base64、电脑绝对路径或敏感正文。

Out of scope:

- 不修改桌面端附件上传、预览或会话渲染协议。
- 不向手机开放电脑端原始图片路径或完整附件内容。
- 不实现超过 16MB 的分块上传或服务端图片压缩。

## Impact

- Backend: `src-tauri/src/mobile_companion.rs` 的移动网关、实时运行快照和历史投影。
- Frontend: 无代码改动；继续复用现有 `ConversationPane` / `ConversationTurn` 展示附件摘要。
- Persistence: 不改 SQLite schema，只在既有 turn JSON 中写入脱敏 `userContentBlocks`。

## Acceptance Criteria

- [x] 移动端待发送图片缩略图不再被 CSP 拦截。
- [x] 约 3MB JSON 图片请求不会再被默认 2MB 限制返回 413。
- [x] 纯图片消息在实时运行与刷新后的历史中均保留附件卡片。
- [x] 模型仍收到原始图片 content block。
- [x] 移动 API 和历史不返回 base64 或电脑绝对路径。
- [x] 桌面端前端和附件机制不受影响。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test src/mobile/*.test.ts`
- `git diff --check`
- 重建并重启 `codem-agent-mux` 后检查移动 CSP、3MB 请求和纯图片回合响应。

## Implementation Record

- 2026-08-16T03:49:19.759Z 完成移动端图片附件链路修复：blob 预览 CSP、16MB 有界请求体、实时与历史纯图片附件摘要，并保证不持久化 base64 或绝对路径。
- 2026-08-16T03:38:38.221Z 定位并修复移动附件三处链路：CSP 缺少 blob 导致缩略图裂开；网关默认 2MB 导致大图 413；移动实时和历史投影未携带安全附件摘要导致纯图片消息为空。

- 2026-08-16T03:30:12.208Z Task created by Trellis automation.

## Verification Results

- 2026-08-16T04:04:22.233Z `桌面开发模式重启`: codem.exe 与 codem-agent-mux.exe 已重建并启动；移动地址 http://100.108.151.13:3210 可访问。
- 2026-08-16T04:04:21.262Z `移动网关 3MB JSON 请求`: 返回业务层 404 而非 413，确认请求已通过有界 16MB body limit。

- 2026-08-16T04:04:20.205Z `移动网关真实纯图片链路`: 空文本图片在运行中和移除实时缓存后的历史均返回 image 摘要；不含 base64 和电脑绝对路径。
- 2026-08-16T04:04:19.255Z `git diff --check`: 通过，未发现空白错误。

- 2026-08-16T04:04:18.214Z `node --import tsx --test src/mobile/*.test.ts`: 29 passed，0 failed。
- 2026-08-16T04:04:17.249Z `npm run build`: 通过；Vite 生产构建完成。

- 2026-08-16T04:04:16.180Z `npm run typecheck`: 通过。
- 2026-08-16T04:04:15.221Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`: 39 passed，0 failed；覆盖纯图片实时摘要、历史补齐、CSP、16MB 请求限制和脱敏。

## Completion Summary
- 2026-08-16T04:04:49.104Z 修复移动端图片附件链路：允许 blob 缩略图、将移动 API 请求体上限设为 16MB，并让纯图片消息在实时与持久化历史中保留脱敏附件摘要；同回合桌面历史会被补齐而不会重复。已重建并重启桌面开发模式和 Agent Mux，真实 API 验证通过。

## Follow-ups

- 待补充。
