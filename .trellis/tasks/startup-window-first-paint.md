# Task: 修复桌面首帧空白

## Background

待补充背景。

## Objective

避免透明桌面窗口在 WebView 首屏绘制前短暂显示空白

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
- 2026-08-21T01:20:46.799Z 确认现象为 1-2 秒首帧空白而非启动失败；将主窗口设为启动时不可见，并在 Tauri PageLoadEvent::Finished 后显示。

- 2026-08-21T01:20:46.496Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T01:20:47.094Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem`: 通过，仅有既有 dead_code 警告

## Completion Summary
- 2026-08-21T01:20:47.405Z 通过窗口可见时序修复消除透明桌面壳首帧空白：WebView 完成页面加载后才显示主窗口。

## Follow-ups

- 待补充。
