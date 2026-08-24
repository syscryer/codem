# Task: 修复 DSH Host 批量清理超时

## Background

待补充背景。

## Objective

解决 DSH 更新前 Windows Host 清理脚本逐个 taskkill 超时导致 npm 未执行的问题，并验证实际更新流程。

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

- 2026-08-24T07:39:00.952Z Review 修复：dsh.rs 中 terminate_child_tree 的 taskkill、query_code_m_dsh_web_host_pids 的 powershell、shutdown_code_m_web_hosts 的 taskkill 三处 spawn 补 CREATE_NO_WINDOW(0x08000000)，与 dsh_process_command 既有惯例一致，避免桌面版更新 DSH 时闪黑色控制台窗口；DSH Web Host 父进程白名单补 codem-backend.exe，覆盖 Web 开发模式后端（src-tauri/src/bin/codem-backend.rs 与桌面共用 backend 代码）启动的 Host。
- 2026-08-24T07:11:05.375Z 根因确认：旧实现把 DSH Host PID 收集与 taskkill 放在 PowerShell 批处理脚本中，清理结果不可验证；同时生命周期命令解析对 deepseek-dsh 走了 Claude fallback，导致更新前没有稳定使用 dsh.ps1。修复为 Rust 查询精确 PID、直接批量 taskkill、250ms 后复查，并把 DSH 接入 resolve_dsh_command；版本复核统一使用 read_dsh_cli_version。

- 2026-08-24T06:33:18.334Z Task created by Trellis automation.

## Verification Results

- 2026-08-24T07:39:29.916Z `cargo check --manifest-path src-tauri/Cargo.toml; cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test --manifest-path src-tauri/Cargo.toml dsh`: 通过：cargo check 通过（仅 main.rs 既有 dead_code warning，与本次无关）；cargo fmt --check 仅报 main.rs 三处既有 diff（本次未触碰 main.rs，dsh.rs 格式干净）；dsh 相关 18 个测试全部通过（含 dsh_update_rejects_busy_runtime_phases 与两个 dist-tag 测试）
- 2026-08-24T07:11:11.510Z `DSH 更新清理与实际生命周期验证`: 通过：cargo test backend::tests 173 passed；cargo test dsh::tests 6 passed；npm run typecheck 通过；当前调试桌面壳调用 /api/agents/lifecycle 返回 HTTP 200，命令为 C:\\Users\\syscr\\AppData\\Roaming\\npm\\dsh.ps1，npm 退出码 0，最终版本 0.1.1-rc.2，无 EBUSY。

## Completion Summary

- 2026-08-24T07:39:34.602Z Review 修复完成：DSH 清理链路三处 Windows spawn（taskkill x2、powershell x1）补齐 CREATE_NO_WINDOW，桌面版更新 DSH 不再闪控制台窗口；Web Host 父进程白名单补 codem-backend.exe，Web 开发模式后端启动的遗留 Host 也能被清理。桌面开发壳已用新代码重启（codem.exe PID 23496）并验证运行。
- 2026-08-24T07:11:19.882Z 已修复 DSH 更新前 Windows Host 清理与 DSH 命令解析：Rust 精确查询匹配 Host PID，批量 taskkill /T /F 后复查；deepseek-dsh 使用 dsh.ps1 解析与版本读取；生命周期成功更新到 0.1.1-rc.2。

## Follow-ups

- 待补充。
