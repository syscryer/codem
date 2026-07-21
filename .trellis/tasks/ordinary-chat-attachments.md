# Task: 修复普通聊天附件读取与图片输入

## Background

普通聊天已经有统一的 `contentBlocks`、图片 Base64 和 MCP 运行链，但桌面文件选择路径与浏览器上传路径行为不一致：桌面端的文本/代码文件会降级为 `file_reference`，普通聊天后端不会读取该路径，模型只能看到文件名或路径。图片选择和剪贴板粘贴虽已有入口，也需要通过测试锁定其多模态映射和错误收口。

## Objective

让普通聊天的桌面文本附件真正进入模型上下文，并稳定支持图片文件选择和粘贴，补充能力提示与历史脱敏验证

## Scope

In scope:

- 普通聊天桌面端文本/代码附件的安全读取与内容块归一化。
- 普通聊天图片文件选择与剪贴板粘贴的输入链路检查、错误提示和多协议映射验证。
- 保留历史记录中的附件脱敏，不把文件正文或图片 Base64 写入历史摘要。
- 补充前端归一化和 Rust 运行时回归测试。

Out of scope:

- 不把普通聊天改成 Agent 或引入子 Agent。
- 不实现 PDF/DOCX 深度解析。
- 不允许普通聊天通过附件读取执行命令或写入文件。
- 不改变现有 Agent 会话、MCP 配置和普通聊天数据库 schema。

## Impact

- Frontend: `Composer`、普通聊天模型能力描述、附件内容块测试。
- Backend: `ordinary_chat/runtime.rs` 的附件归一化/读取和 provider 输入适配。
- Persistence: 仅保留附件路径、名称、类型和大小等摘要，不新增敏感正文持久化。

## Acceptance Criteria

- [x] 桌面端选择文本/代码文件后，普通聊天模型能够获得文件正文；路径不可读时明确报错，不静默丢失。
- [x] 图片可通过文件选择和剪贴板粘贴发送；无法识别或供应商拒绝图片输入时沿普通聊天错误链路明确展示。
- [x] 历史记录和运行日志不包含文件正文、图片 Base64 或大附件原文。
- [x] 现有 Agent 附件链路、普通聊天 MCP/知识库和运行事件不回归。
- [x] `npm run typecheck`、相关 TypeScript 测试、Rust 格式检查和普通聊天定向 Rust 测试通过。

## Verification Commands

- `npm run typecheck`
- `node --test --import tsx src/lib/composer-input-files.test.ts src/lib/input-content-blocks.test.ts src/lib/claude-run-attachments.test.ts`
- `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/runtime.rs src-tauri/src/ordinary_chat/types.rs`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`
- `git diff --check`

## Implementation Record

- 2026-07-21T01:25:26.924Z 修复普通聊天桌面图片缩略图：项目文件仍走 workspace 受限预览，普通聊天附件改走独立桌面附件预览接口并复用敏感路径、格式和大小校验，避免外部图片被 403 拒绝。
- 2026-07-20T18:23:22.952Z 修复普通聊天桌面附件归一化：发送前安全读取 1MB 内文本/代码与 10MB 内图片，无法读取或不支持的附件明确报错；历史移除文件正文和图片 Base64，后续追问与重试按原路径恢复；锁定图片选择、粘贴及四类供应商协议映射。

- 2026-07-20T17:52:22.532Z Task created by Trellis automation.

## Verification Results
- 2026-07-21T01:25:27.464Z `npm run typecheck；node --test --import tsx src/lib/file-preview-api.test.ts src/lib/composer-input-files.test.ts；cargo check --manifest-path src-tauri/Cargo.toml；rustfmt --edition 2021 --check src-tauri/src/backend.rs；git diff --check（本次文件）`: pass：TypeScript 通过，前端 17/17，Rust 编译通过，本次 backend.rs 格式与 diff 检查通过；全仓 cargo fmt 仅受其他未提交 Rust 文件既有格式差异影响。

- 2026-07-20T18:23:23.644Z `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/runtime.rs src-tauri/src/ordinary_chat/types.rs；cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime；cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests::maps_image_blocks_to_each_provider_protocol；git diff --check`: 通过：普通聊天 runtime 6/6、图片协议映射 1/1，定向 Rust 格式与差异检查通过；仅既有 dead_code/CRLF 提示。
- 2026-07-20T18:23:23.317Z `npm run typecheck；node --test --import tsx src/lib/composer-input-files.test.ts src/lib/input-content-blocks.test.ts src/lib/claude-run-attachments.test.ts`: 通过：TypeScript 编译通过，附件相关测试 34/34 通过，覆盖普通聊天图片文件选择与剪贴板粘贴。

## Completion Summary

- 2026-07-21T01:25:28.010Z 普通聊天图片发送后缩略图不再复用项目目录预览权限；桌面任意安全图片路径可在普通聊天消息卡片中显示，Agent/项目文件预览边界保持不变。
- 2026-07-20T18:23:52.793Z 完成普通聊天附件修复：桌面文本/代码和图片路径会在运行前安全读取，图片文件选择与粘贴保持内联多模态发送，历史仅保存摘要并支持从原路径恢复，异常附件不再静默丢失。

## Follow-ups

- PDF/DOCX 深度解析和模型视觉能力目录仍按后续独立任务处理。
