# Task: 修复 macOS Private API 配置漂移

## Background

`src-tauri/tauri.macos.conf.json` 已开启 `app.macOSPrivateApi`，但 `src-tauri/Cargo.toml`
在 2026-07-18 的修改中移除了对应的 `macos-private-api` feature，导致桌面打包静态门禁持续失败，
并可能使 macOS 配置与实际编译能力不一致。

## Objective

恢复 Tauri macOS Private API Cargo feature 与桌面配置一致性，并保持全量测试门禁可执行

## Scope

In scope:

- 恢复 Tauri `macos-private-api` Cargo feature。
- 验证 macOS 桌面配置与 Cargo feature 保持一致。
- 记录该基线问题的定向与全量验证结果。

Out of scope:

- 不调整 macOS 窗口材质、标题栏或 WebKit 合成行为。
- 不修改 Tauri 版本或桌面打包产物结构。
- 不在当前 Windows 环境宣称完成真实 macOS 安装包运行验证。

## Impact

- `src-tauri/Cargo.toml`
- `src/lib/desktop-packaging.test.ts` 既有一致性门禁

## Acceptance Criteria

- [x] `app.macOSPrivateApi` 与 Tauri `macos-private-api` feature 同时启用。
- [x] `src/lib/desktop-packaging.test.ts` 全部通过。
- [x] Rust 测试、格式检查和前端全量测试通过。
- [x] 明确记录未在 Windows 上执行真实 macOS 打包运行验证。

## Verification Commands

- `node --import tsx --test "src/lib/desktop-packaging.test.ts"`
- `node --import tsx --test "src/**/*.test.ts"`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record

- 2026-08-01T17:00:28.226Z 首次将 macos-private-api 加到全局 tauri feature 后，Windows cargo test 被 Tauri build script 拒绝：feature 与当前 tauri.conf.json allowlist 不匹配。根因是该 feature 必须受 macOS target cfg 限定；调整为全局 tauri 仅 unstable，并在 cfg(target_os = macos) 依赖段启用 macos-private-api。
- 2026-08-01T16:58:40.186Z 确认全量前端测试的第三个失败为既有 macOS 配置漂移：tauri.macos.conf.json 开启 macOSPrivateApi，但 Cargo feature 在 5c215257 中被移除；本机 Tauri 2.11.x 仍声明 macos-private-api。采用独立一行恢复并保留既有静态门禁。另两个失败仅更新为共享 FileActionMenu 和扩展 Markdown 回调后的结构断言。

- 2026-08-01T16:57:29.191Z Task created by Trellis automation.

## Verification Results
- 2026-08-01T17:02:22.470Z `git diff --check`: 退出码 0；仅提示 Windows 工作区 LF 将转换为 CRLF。

- 2026-08-01T17:02:21.757Z `npm run build`: tsc -b 与 Vite 生产构建退出码 0；保留既有动态导入与大 chunk 警告。
- 2026-08-01T17:02:21.046Z `npm run typecheck`: tsc -b 退出码 0。

- 2026-08-01T17:02:20.343Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 退出码 0。
- 2026-08-01T17:02:19.645Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust 库测试 241 passed、1 个需认证 Grok smoke ignored；桌面壳 13 passed；0 failed。存在既有 dead_code/linker warning。

- 2026-08-01T17:02:18.944Z `node --import tsx --test "src/**/*.test.ts"`: 673/673 通过，0 failed。
- 2026-08-01T17:02:18.291Z `node --import tsx --test "src/lib/desktop-packaging.test.ts"`: 4/4 通过，macOS 配置与 target-specific Cargo feature 一致。

## Completion Summary
- 2026-08-01T17:02:54.274Z 恢复 macOS target-specific Tauri macos-private-api feature，使 Cargo 编译能力与 tauri.macos.conf.json 一致。前端 673/673、Rust 241+13、fmt、typecheck、build 和 diff check 均通过；Windows 环境未执行真实 macOS 安装包运行验证。

## Follow-ups

- 在 macOS CI 或发布流程中继续完成真实桌面打包验证。
