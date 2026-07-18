# Task: 修复 Agent 设置加载时 CMD 窗口闪现

## Background

待补充背景。

## Objective

确保 Agent 设置首次诊断、版本探测和命令解析在 Windows 下不显示控制台窗口，并覆盖所有相关子进程路径。

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

- 2026-07-18T14:59:23.792Z 验证确认 Agent 设置加载相关的版本读取、CLI 解析、诊断和生命周期命令已使用隐藏 helper；本次补齐 Windows reg 与 where 探测路径。
- 2026-07-18T14:58:23.271Z 定位并修复 Agent 设置首次加载中的两个 Windows 控制台窗口来源：代理读取改用隐藏的 reg 子进程，包管理器探测改用隐藏的 where/which helper；版本探测和 Agent CLI 启动路径已确认原本使用隐藏 helper。

- 2026-07-18T14:56:46.382Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T14:59:23.032Z `npm run typecheck; cargo test --manifest-path src-tauri/Cargo.toml; git diff --check`: typecheck 通过；Rust 全量测试 170 passed、1 ignored，主程序 13 passed；diff check 通过。cargo fmt --check 仍受已有 agent_channels.rs/automation.rs 格式差异影响，本次 backend.rs 未产生格式差异。

## Completion Summary
- 2026-07-18T15:02:51.423Z 已修复 Agent 设置首次加载时 Windows CMD 窗口闪现：系统代理读取和包管理器路径探测统一使用 CREATE_NO_WINDOW 隐藏子进程。类型检查、Rust 全量测试和 diff check 通过；桌面开发模式已重启并运行在 http://127.0.0.1:5173（后端 3002）。cargo fmt check 的失败来自本次未修改的既有格式差异。

## Follow-ups

- 待补充。
