# Task: DSH 更新前停止 Host 并恢复运行

## Background

待补充背景。

## Objective

修复 DeepSeek DSH 全局 npm 更新被 CodeM 管理的 Web Host 占用导致长时间等待、失败或版本不变的问题；更新前仅停止 CodeM 管理的 DSH Host，更新后校验版本并按需恢复。

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
- 2026-08-24T06:24:48.393Z 验证完成：cargo check 通过；agent_run 测试 114 通过；backend 测试 174 通过；dsh 测试 6 通过；npm run typecheck 与 npm run build 通过；onboarding gate 仍有 2 个既有断言失败，详见交接。

- 2026-08-24T06:24:48.062Z 已完成 DSH 更新前置清理：拒绝运行中的 DSH 任务和热会话，关闭 CodeM 管理的 DSH Runtime，并在 Windows 通过进程树清理当前及遗留的 DSH Web Host；npm 更新失败时前端重新 bootstrap DSH；更新成功后版本未变化直接报错。
- 2026-08-24T06:03:55.096Z 已确认修复边界：DSH 更新只停止 CodeM 管理且空闲的 Web Host；存在运行中 DSH 任务时拒绝更新；更新后重新探测并把版本未变化视为失败；不触碰用户手工 DSH、其他 Provider、npm 镜像和凭据。

- 2026-08-24T06:00:00.547Z Task created by Trellis automation.

## Verification Results
- 2026-08-24T06:25:03.473Z `python check_onboarding.py D:\\ai_proj\\codem`: 未通过：2 个既有断言（Provider 数量旧值、历史 composer 正则），与本次 DSH 更新改动无关

- 2026-08-24T06:25:03.133Z `npm run typecheck && npm run build`: 通过
- 2026-08-24T06:25:02.782Z `cargo check --manifest-path src-tauri/Cargo.toml; cargo test agent_run::tests; cargo test backend::tests; cargo test dsh::tests`: 通过：114 + 174 + 6 tests

## Completion Summary
- 2026-08-24T06:25:43.085Z DSH 更新链路已完成：更新前拒绝活动任务、停止 CodeM 管理的 DSH Host 与遗留 Web Host，更新后校验版本变化，失败时恢复 DSH UI；Rust/前端验证通过，onboarding gate 的 2 个旧断言失败已记录为既有问题。

## Follow-ups

## Confirmed Context

2026-08-24 生产日志显示 DSH 生命周期更新请求分别耗时 118.7 秒并返回 200、57.2 秒并返回 500；当前 `dsh` 仍为 `0.1.0-rc.7`。本机同时存在多个 CodeM 启动的 DSH Web Host，正在占用全局 npm 包目录中的 `sharp` 原生文件，Windows 更新时无法安全替换依赖树。

## Scope Decision

- 更新 DSH 前停止 CodeM 管理的空闲 DSH Web Host，并等待子进程退出与文件句柄释放。
- 有 DSH 运行中的会话时拒绝更新，不强制杀掉用户正在执行的任务。
- 更新完成后重新探测 CLI；版本未变化时返回明确失败，不把旧版本当作成功。
- 保持现有 DSH Web Host 在下一次 bootstrap/运行时按需重新启动。
- 非 DSH Provider、用户手工启动的 DSH、npm 镜像策略和 DSH 配置/凭据不在本次范围。

## Acceptance Addendum

- [ ] DSH 更新前仅停止 CodeM 管理的空闲 Host，并等待停止完成。
- [ ] DSH 仍有运行中任务时更新被明确拒绝，任务不被强制终止。
- [ ] 更新结束后重新探测版本；版本未变化时返回失败并保留可诊断原因。
- [ ] 更新后的下一次 DSH bootstrap 可以重新创建 Web Host。
- [ ] Rust、TypeScript、构建和定向生命周期测试通过。

## Verification Addendum

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_lifecycle dsh`
- `npm run typecheck`
- `npm run build`

- 待补充。
