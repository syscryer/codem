# Session Record: 修复 Rust 后端 Windows Claude 启动

- Session: session-20260712-022741-md0m
- Started: 2026-07-12T02:27:41.266Z
- Task: .trellis/tasks/fix-windows-claude-command.md

## Notes

- 2026-07-12T02:35:18.074Z Implemented Windows Claude lookup parity with origin/main: UTF-8 PowerShell Get-Command lookup plus spawnable extension selection. Rust keeps direct Command spawning because the active toolchain safely launches .cmd without shell interpolation.
- 2026-07-12T02:29:40.363Z Compared origin/main Node backend: ported UTF-8 PowerShell lookup and Windows spawnable extension filtering into Rust; added regression coverage for extensionless npm shim ordering.

- 2026-07-12T02:27:41.268Z Session started.

## Verification

- 2026-07-12T02:35:52.510Z `npm.cmd run package:win`: Passed: generated CodeM_0.1.9_x64-setup.exe and CodeM_0.1.9_x64_en-US.msi.
- 2026-07-12T02:35:44.606Z `release backend /api/claude/version-info probe`: Passed: backend identity=rust; command=C:\Users\syscr\AppData\Roaming\npm\claude.cmd; version=2.1.196; installed=true; supported=true.

- 2026-07-12T02:35:34.667Z `cargo check --manifest-path src-tauri/Cargo.toml --bins`: Passed: all Rust binary targets compile successfully.
- 2026-07-12T02:35:28.493Z `cargo test --manifest-path src-tauri/Cargo.toml`: Passed: 14 tests total, including 3 new Claude command selection regressions; 0 failed.

## Completed

- 2026-07-12T02:36:38.571Z Fixed Windows Claude CLI discovery in the Rust backend by porting origin/main's UTF-8 PowerShell lookup and spawnable extension preference, added regression tests, verified the release backend resolves claude.cmd 2.1.196, and rebuilt NSIS/MSI installers.
