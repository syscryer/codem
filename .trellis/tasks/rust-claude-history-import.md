# Task: 补齐 Rust Claude 历史导入

## Background

The Node backend imports Claude Code sessions during workspace bootstrap by scanning `~/.claude/projects/*/*.jsonl`. The Rust backend created the related SQLite columns and ignored-session table, but never ported the discovery and upsert flow. As a result, a clean Rust installation only shows sessions already created through CodeM.

Local verification found three Claude transcripts across two projects while the Rust CodeM database contained only one project and one thread.

## Objective

按 main 语义扫描 ~/.claude/projects 会话，幂等导入项目与线程，保留忽略和删除边界，并通过真实冷启动验证

## Scope

In scope:

- Scan Claude project transcript directories during Rust workspace bootstrap.
- Parse session id, cwd, title candidates, model, permission mode, and updated time without loading whole transcript files into memory.
- Idempotently upsert imported projects and threads while preserving custom names and titles.
- Respect `ignored_imported_sessions` and record ignored sessions when a thread/project is removed or its session binding changes.
- Verify cold-start import against isolated fixtures and the real local Claude history.

Out of scope:

- Frontend payload or layout changes.
- Deleting source Claude transcript files when a CodeM thread/project is removed; ignored-session records prevent re-import without destructive source deletion.
- Broad parity fixes outside the history import lifecycle.

## Impact

- `src-tauri/src/backend.rs` workspace bootstrap, metadata persistence, and deletion lifecycle.
- Existing `projects`, `threads`, and `ignored_imported_sessions` tables; no schema migration is required.

## Acceptance Criteria

- [x] Bootstrap imports valid `~/.claude/projects/*/*.jsonl` sessions whose cwd still exists.
- [x] Repeated bootstrap scans are idempotent and do not create duplicate projects or threads.
- [x] Existing custom project names and thread titles are preserved.
- [x] Ignored sessions are not re-imported after deletion or session reassignment.
- [x] Missing, malformed, sidechain, metadata-only, and `agent-*` files do not create visible sessions.
- [x] Existing CodeM-created sessions remain attached to their original thread and gain updated transcript metadata.
- [x] Real local cold-start verification exposes all three current Claude transcripts across two projects.

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --bins`
- Isolated release backend `/api/workspace/bootstrap` probe with an empty database and real Claude home
- `npm.cmd run package:win`

## Implementation Record

- 2026-07-12T02:57:35.173Z Real cold-start probe passed with an empty temporary CodeM database: Rust bootstrap discovered 2 projects and all 3 local Claude transcripts (notra=2, dev5=1). The existing user database was not modified.
- 2026-07-12T02:53:20.756Z Ported the main history discovery design into Rust: line-by-line JSONL metadata parsing, bootstrap import, idempotent project/thread upsert, custom title preservation, and ignored-session persistence without deleting source transcripts.

- 2026-07-12T02:46:06.325Z Task created by Trellis automation.

## Verification Results
- 2026-07-12T03:01:07.086Z `cargo clippy --manifest-path src-tauri/Cargo.toml --bins -- -D warnings`: Not clean: blocked by 19 pre-existing warnings in unrelated existing backend code. No warning was reported in the new history import functions; cargo check and tests pass.

- 2026-07-12T03:00:56.269Z `npm.cmd run package:win`: Passed: generated updated CodeM_0.1.9_x64-setup.exe and CodeM_0.1.9_x64_en-US.msi.
- 2026-07-12T03:00:38.674Z `debug and release empty-database /api/workspace/bootstrap probes`: Passed: both Rust binaries discovered projects=2 and threads=3 from the real local Claude history; repeated release bootstrap remained projects=2, threads=3 (idempotent). Existing user database was not modified.

- 2026-07-12T03:00:24.018Z `cargo fmt --check; cargo check --bins; npm.cmd run typecheck; git diff --check`: Passed: Rust formatting, all binary compilation, frontend typecheck, and whitespace checks. diff check only reports existing Windows LF/CRLF notices.
- 2026-07-12T03:00:12.340Z `cargo test --manifest-path src-tauri/Cargo.toml`: Passed: 16 tests total; 0 failed. Includes isolated import idempotence, custom-title preservation, existing CodeM thread reuse, ignored deletion, malformed and agent-file coverage.

## Completion Summary
- 2026-07-12T03:01:51.645Z Completed Rust Claude history parity for non-destructive import: bootstrap scans local JSONL transcripts line by line, idempotently upserts projects/threads, preserves custom titles, records ignored sessions on deletion/rebinding, keeps source transcripts intact, passes 16 tests and real debug/release cold-start probes, and ships updated Windows installers.

## Follow-ups

- Decide separately whether CodeM deletion should also remove Claude source transcripts; this task deliberately keeps source history intact.
