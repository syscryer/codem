# Task: 修复 Claude 内容块 Rust 契约

## Background

遗留 Node 后端删除后，Claude 运行入口由 Rust `backend.rs` 独立承接。前端仍按统一 `contentBlocks` 契约发送文本、图片、小文本文件、文件引用和附件元数据，但 Rust adapter 只识别其中一部分类型，并且在 adapter 转换前仅按文本 prompt 判空，造成附件正文或引用丢失、纯 base64 图片被错误拒绝。

## Objective

让 Rust Claude bridge 完整处理 text、image、file_text、file_reference、attachment_metadata，并覆盖普通发送与 guide 回归测试

## Scope

In scope:

- Rust Claude adapter 完整映射 `text`、`image`、`file_text`、`file_reference`、`attachment_metadata`。
- 普通运行按 adapter 实际生成的 stdin 内容判空，允许只有有效附件而没有文本的请求。
- Guide 复用同一 adapter，保证附件语义不会因为运行中输入路径不同而丢失。
- 保留图片多模态 block，并在存在本地路径时追加 `ViewImage` 兜底说明。
- 补充 Rust 单元测试，覆盖五类内容块、纯图片、空块、历史摘要脱敏和 tool result 优先级。

Out of scope:

- 不修改前端 `InputContentBlock` 类型和 Composer 交互。
- 不新增 PDF、DOCX 或 document block。
- 不恢复 Node 后端或双运行路径。
- 不修改 SQLite schema、stream event 或普通聊天机制。

## Impact

- `src-tauri/src/backend.rs` 的 Claude 请求判空、stdin message adapter 和对应测试。
- `/api/claude/run` 与 `/api/claude/run/:runId/guide` 继续使用现有请求字段和响应结构。

## Acceptance Criteria

- [x] 文本与 `file_text` 同时发送时，模型输入包含用户文本和完整文件正文。
- [x] 文本与 `file_reference` 同时发送时，模型输入包含可读取路径和引用原因。
- [x] `attachment_metadata` 转换为明确的未直接发送说明。
- [x] 纯 base64 图片不会再被判定为空；带本地路径的图片同时保留 `ViewImage` 兜底文本。
- [x] 普通运行和 Guide 使用同一内容块转换逻辑。
- [x] 历史摘要移除 base64 和 `file_text` 正文，只保留安全大小摘要。
- [x] Rust 定向测试、全量测试、格式检查与 Git 差异检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml claude_input`
- `cargo test --manifest-path src-tauri/Cargo.toml summarize_content_blocks`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## Implementation Record

- 2026-07-15T09:53:19.802Z 完成 Rust Claude adapter 修复：普通运行与 guide 按实际 stdin message 判空；五类 contentBlocks 完整映射；图片路径保留 ViewImage 兜底；活动运行摘要剥离 base64 与 file_text 正文。定向 Rust 测试 5/5 通过。
- 2026-07-15T09:48:32.576Z 确认修复边界：不改前端协议；Rust adapter 统一映射五类内容块，普通运行与 guide 都按实际 stdin 内容判空，并迁移 Node 删除前的关键契约断言。

- 2026-07-15T09:45:30.484Z Task created by Trellis automation.

## Verification Results

- 2026-07-15T09:56:51.280Z `GET http://127.0.0.1:3001/api/health 与 GET http://127.0.0.1:5173/`: 重启最新 Rust backend 后两个地址均返回 HTTP 200
- 2026-07-15T09:56:44.913Z `cargo test --manifest-path src-tauri/Cargo.toml`: Rust lib 114 通过、1 个真实 Grok smoke 按设计忽略；desktop 9/9 通过；doc tests 通过

- 2026-07-15T09:56:31.684Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；npm run typecheck；git diff --check`: 全部通过；diff check 仅有既有 Windows 行尾提示
- 2026-07-15T09:56:22.980Z `cargo test --manifest-path src-tauri/Cargo.toml claude_input 与 summarize_content_blocks`: Claude 输入转换 4/4、内容块脱敏摘要 1/1 通过

## Completion Summary
- 2026-07-15T09:57:21.199Z 已修复 Rust Claude contentBlocks 契约：五类输入完整映射，纯附件按实际 stdin 内容判空，普通运行与 guide 共用 adapter，历史摘要脱敏；定向与全量 Rust 测试、类型、格式、差异和运行健康检查均通过。

## Follow-ups

- `requirements.md` 与 `roadmap.md` 的旧 Node 当前架构描述另行整理，不与本次 P1 修复混入。
