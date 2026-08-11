# Session Record: 修复 Hermes 最新版本号误判

- Session: session-20260811-034641-plz6
- Started: 2026-08-11T03:46:41.299Z
- Task: .trellis/tasks/hermes-version-normalization.md

## Notes
- 2026-08-11T03:54:42.311Z 重启桌面开发壳后，通过动态 Agent Mux runtime 文件读取端口和令牌，真实调用 Hermes latest-version 接口；返回 latestVersion=0.20.0、updateAvailable=false、error=null，runtime identity 为 app=codem/backend=rust。

- 2026-08-11T03:51:02.433Z 将 Hermes GitHub Release 版本查询改为从 Release name 提取产品语义版本；通用 GitHub tag 解析保持不变，并新增两组回归测试。
- 2026-08-11T03:50:46.377Z 将 Hermes GitHub Release 版本查询改为从 Release name 提取产品语义版本；通用 GitHub tag 解析保持不变，并新增两组回归测试。

- 2026-08-11T03:46:41.302Z Session started.

## Verification

- 2026-08-11T03:51:02.473Z `cargo fmt; cargo test --manifest-path src-tauri/Cargo.toml github_release_tag_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml hermes_github_release_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml --lib; npm run typecheck; npm run build; python onboarding check; git diff --check`: 全部通过；Rust 全量测试 478 项中 477 通过、1 ignored；保留既有编译 warnings。
- 2026-08-11T03:50:46.376Z `cargo fmt; cargo test --manifest-path src-tauri/Cargo.toml github_release_tag_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml hermes_github_release_version_parser --lib; cargo test --manifest-path src-tauri/Cargo.toml --lib; npm run typecheck; npm run build; python C:\Users\syscr\.codex\skills\codem-agent-onboarding\scripts\check_onboarding.py D:\ai_proj\codem; git diff --check`: 全部通过；Rust 全量测试 478 项中 477 通过、1 ignored；保留既有编译 warnings。

## Completed

- 2026-08-11T03:55:00.310Z Hermes 版本查询已按产品语义版本归一化：Release name 提取 0.20.0，日期型 tag 不再参与比较；回归测试、Rust/TypeScript/构建/onboarding/diff 门禁及重启后真实接口验收全部通过。
