# Task: 修复 Windows Codex 安装后无法检测

## Background

Windows 上通过 npm 全局安装 Codex 时，`codex.cmd` 通常写入当前用户的 npm 全局目录。CodeM 进程如果在安装前启动，继承的 PATH 可能没有这个目录，导致安装命令成功但安装后重检仍报告“未检测到可执行文件”。

## Objective

让 CodeM 在旧 PATH 和自定义 npm 全局目录环境下稳定检测已安装的 Codex CLI

## Scope

In scope:

- 保留现有 PATH 和 `CODEX_CLI_PATH` 优先级。
- Windows Codex 增加 npm/pnpm/Volta/Bun 常见用户级目录和包管理器全局目录探测。
- 增加路径候选回归测试，覆盖 `%APPDATA%\\npm\\codex.cmd` 这类安装结构。

Out of scope:

- 不修改 Codex 安装命令、认证配置或 CodeM 的全局 PATH。
- 不改变已有可执行文件的选择顺序和运行协议。

## Impact

- Backend: `resolve_codex_command` 及 Windows 用户级命令路径探测。
- 不涉及前端 API、持久化和运行事件协议。

## Acceptance Criteria

- [x] CodeM 启动时 PATH 未包含 npm 全局目录时，仍能检测 `%APPDATA%\\npm\\codex.cmd`。
- [x] 自定义 npm/pnpm/bun 全局目录可通过包管理器自身查询发现。
- [x] PATH 中已存在的 Codex 候选仍优先使用。
- [x] Rust 格式检查、定向测试和差异检查通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::codex_command`
- `git diff --check`

## Implementation Record
- 2026-07-20T03:24:49.564Z 确认用户 codex doctor 显示 Codex 0.144.6 安装与认证正常，真实安装位于 %APPDATA%\\npm；根因是 CodeM Codex resolver 仅依赖启动时 PATH，未提供用户级 npm 目录兜底。已保留 PATH 优先级并增加 npm/pnpm/Volta/Bun 常见目录与包管理器全局目录探测。

- 2026-07-20T03:14:27.493Z Task created by Trellis automation.

## Verification Results
- 2026-07-20T03:24:55.079Z `rustfmt --edition 2021 --check src-tauri/src/backend.rs；cargo check --manifest-path src-tauri/Cargo.toml --bin codem-backend；git diff --check`: 通过：backend.rs 格式、codem-backend 编译和差异检查均通过；仅既有 dead_code 与行尾提示。

- 2026-07-20T03:24:53.470Z `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::codex_command -- --nocapture`: 通过：1/1，Windows 用户级 npm/pnpm/Volta/Bun Codex 路径候选正确。
- 2026-07-20T03:24:51.707Z `cargo test --manifest-path src-tauri/Cargo.toml backend::tests::windows_ -- --nocapture`: 通过：6/6，包含 npm codex.cmd 不在 PATH 时仍可直接启动并返回版本。

## Completion Summary
- 2026-07-20T03:24:56.447Z 修复 Windows Codex 安装后无法检测：PATH 探测失败时自动查找当前用户 npm/pnpm/Volta/Bun 安装目录，并按包管理器全局 prefix 发现自定义目录；补充 Windows wrapper 启动与路径回归测试。

## Follow-ups

- 待补充。
