# Task: 修复 Rust 后端 Windows Claude 启动

## Background

The Rust backend resolves `claude` from the first line returned by the platform lookup command. On Windows, an npm global install can return the extensionless Unix shell shim before `claude.cmd`. Passing that shell shim to `std::process::Command` fails with Win32 error 193.

The Node backend on `origin/main` already filters Windows candidates to `.exe`, `.cmd`, `.bat`, and `.com`, and uses a UTF-8 PowerShell lookup so non-ASCII user paths remain intact. The Rust migration must preserve that behavior.

## Objective

Windows 下优先解析可由 Rust 正常启动的 Claude CLI shim，避免 os error 193，并补充回归测试与打包验证

## Scope

In scope:

- Resolve Claude CLI candidates with UTF-8 output on Windows.
- Prefer Windows-spawnable command extensions over extensionless npm shell shims.
- Add regression tests for the observed npm shim ordering.
- Verify the real installed Claude CLI and produce Windows packages.

Out of scope:

- Changing Claude CLI arguments or stream protocol behavior.
- Refactoring unrelated process launch helpers.
- Changing frontend error presentation.

## Impact

- `src-tauri/src/backend.rs` Claude command discovery on Windows.
- Rust unit tests and Windows packaging output.

## Acceptance Criteria

- [x] An extensionless `claude` candidate before `claude.cmd` resolves to `claude.cmd`.
- [x] Native Windows command extensions remain supported case-insensitively.
- [x] Non-Windows selection keeps the first lookup candidate.
- [x] The installed Claude CLI version can be queried through the resolved command.
- [x] Rust tests, release compilation, and Windows packaging succeed.

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- Real Windows lookup and `claude.cmd --version` probe
- `npm.cmd run package:win`

## Implementation Record

- 2026-07-12T02:35:18.074Z Implemented Windows Claude lookup parity with origin/main: UTF-8 PowerShell Get-Command lookup plus spawnable extension selection. Rust keeps direct Command spawning because the active toolchain safely launches .cmd without shell interpolation.
- 2026-07-12T02:29:40.363Z Compared origin/main Node backend: ported UTF-8 PowerShell lookup and Windows spawnable extension filtering into Rust; added regression coverage for extensionless npm shim ordering.

- 2026-07-12T02:27:41.268Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T02:35:52.510Z `npm.cmd run package:win`: Passed: generated CodeM_0.1.9_x64-setup.exe and CodeM_0.1.9_x64_en-US.msi.
- 2026-07-12T02:35:44.606Z `release backend /api/claude/version-info probe`: Passed: backend identity=rust; command=C:\Users\syscr\AppData\Roaming\npm\claude.cmd; version=2.1.196; installed=true; supported=true.

- 2026-07-12T02:35:34.667Z `cargo check --manifest-path src-tauri/Cargo.toml --bins`: Passed: all Rust binary targets compile successfully.
- 2026-07-12T02:35:28.493Z `cargo test --manifest-path src-tauri/Cargo.toml`: Passed: 14 tests total, including 3 new Claude command selection regressions; 0 failed.

## Completion Summary
- 2026-07-12T02:36:38.571Z Fixed Windows Claude CLI discovery in the Rust backend by porting origin/main's UTF-8 PowerShell lookup and spawnable extension preference, added regression tests, verified the release backend resolves claude.cmd 2.1.196, and rebuilt NSIS/MSI installers.

## Follow-ups

- None planned.
