# Session Record: 修复 Claude 内容块 Rust 契约

- Session: session-20260715-094530-ovz0
- Started: 2026-07-15T09:45:30.481Z
- Task: .trellis/tasks/claude-content-blocks-rust-contract.md

## Notes

- 2026-07-15T09:53:19.802Z 完成 Rust Claude adapter 修复：普通运行与 guide 按实际 stdin message 判空；五类 contentBlocks 完整映射；图片路径保留 ViewImage 兜底；活动运行摘要剥离 base64 与 file_text 正文。定向 Rust 测试 5/5 通过。
- 2026-07-15T09:48:32.576Z 确认修复边界：不改前端协议；Rust adapter 统一映射五类内容块，普通运行与 guide 都按实际 stdin 内容判空，并迁移 Node 删除前的关键契约断言。

- 2026-07-15T09:45:30.485Z Session started.

## Verification

- 2026-07-15T09:56:51.280Z `GET http://127.0.0.1:3001/api/health 与 GET http://127.0.0.1:5173/`: 重启最新 Rust backend 后两个地址均返回 HTTP 200
- 2026-07-15T09:56:44.913Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust lib 114 通过、1 个真实 Grok smoke 按设计忽略；desktop 9/9 通过；doc tests 通过

- 2026-07-15T09:56:31.684Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；npm run typecheck；git diff --check`: 全部通过；diff check 仅有既有 Windows 行尾提示
- 2026-07-15T09:56:22.980Z `cargo test --manifest-path src-tauri/Cargo.toml claude_input 与 summarize_content_blocks`: Claude 输入转换 4/4、内容块脱敏摘要 1/1 通过

## Completed

- 2026-07-15T09:57:21.199Z 已修复 Rust Claude contentBlocks 契约：五类输入完整映射，纯附件按实际 stdin 内容判空，普通运行与 guide 共用 adapter，历史摘要脱敏；定向与全量 Rust 测试、类型、格式、差异和运行健康检查均通过。
