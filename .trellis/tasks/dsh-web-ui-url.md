# Task: 展示 DSH Web UI 地址

## Background

待补充背景。

## Objective

从托管 DSH Web Host 返回真实动态地址，并在 DSH 设置概览页展示可打开和复制的 Web UI 地址

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
- 2026-08-14T10:01:41.913Z 已将 DSH Web Host 实际动态地址从后端 bootstrap 传到前端，概览页新增可打开和复制的 Web UI 地址；未使用固定端口或静默兜底。

- 2026-08-14T10:00:06.716Z Task created by Trellis automation.

## Verification Results
- 2026-08-14T10:06:16.294Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture; npm.cmd run build; git diff --check; desktop:dev restart; GET http://127.0.0.1:5173/`: 全部通过；DSH 定向测试 10/10，前端构建成功，桌面开发模式重启后 5173 返回 200。

## Completion Summary
- 2026-08-14T10:06:29.176Z 已完成 DSH Web UI 地址展示：后端从托管 Web Host 返回真实动态 URL，前端概览页提供可点击打开和复制入口；定向测试、构建、格式检查和桌面开发模式重启验证通过。

## Follow-ups

- 待补充。
