# Task: 普通聊天历史图片兼容文本模型

## Background

普通聊天允许同一会话切换供应商和模型。当前运行时会恢复历史附件并将所有历史图片继续映射到上游协议；当用户从视觉模型切换到文本模型后，即使当前轮只有纯文本，上游仍会因为历史图片返回“not a VLM / use text-only prompts”，导致后续每一轮都失败。

## Objective

切换到不支持视觉的模型后，保留当前输入语义并自动降级历史图片，避免旧图片导致纯文本消息失败

## Scope

In scope:

- 仅在上游明确拒绝视觉输入、尚未产生任何流式事件且当前轮不含图片时，移除本次运行内存中的历史图片并重试一次。
- 当前轮图片必须保留；文本模型拒绝当前图片时继续展示真实错误。
- 历史数据库中的图片摘要和路径保持不变，切回视觉模型后仍可恢复图片上下文。
- 前端通过普通聊天既有状态事件感知兼容重试，不新增事件类型。

Out of scope:

- 不根据模型名称硬编码视觉能力。
- 不修改供应商或模型配置，不自动删除 OpenRouter 下线模型。
- 不掩盖账户权限、限流、超时或普通 HTTP 错误。
- 不修改 Agent 附件和会话运行链。

## Impact

- Backend：`src-tauri/src/ordinary_chat/runtime.rs` 普通聊天 provider 调用与内存历史适配。
- Persistence：无 schema 或历史数据变更。
- Frontend：沿用现有 `status` 事件，无 contract 变更。

## Acceptance Criteria

- [x] 历史含图片、当前轮纯文本且上游明确不支持视觉时，自动移除历史图片并仅重试一次。
- [x] 当前轮含图片时不做兼容降级，继续透传供应商错误。
- [x] 已产生流式事件、非视觉错误或没有历史图片时不重试。
- [x] 降级只影响当前运行内存，不改写持久化历史。
- [x] 普通聊天附件、四协议图片映射和 Agent 运行不回归。

## Verification Commands

- `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/runtime.rs`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests::maps_image_blocks_to_each_provider_protocol`
- `npm run typecheck`
- 使用本机 Silicon `deepseek-ai/DeepSeek-V4-Flash` 对包含历史图片的现有普通聊天发送纯文本，确认兼容重试成功。
- `git diff --check`

## Implementation Record
- 2026-07-22T07:06:43.992Z 补充 DeepSeek/OpenAI 兼容错误识别：messages[n] unknown variant image_url, expected text；仍要求历史图片存在、当前轮无图片且尚未产生事件。

- 2026-07-22T06:28:15.806Z 补充 OpenRouter 视觉拒绝文案：No endpoints found that support image input；继续复用仅历史图片、当前轮无图片且尚未输出时的单次重试边界。
- 2026-07-22T03:35:37.906Z 已确认失败根因：普通聊天切换文本模型后仍发送历史图片。实现仅在上游明确拒绝视觉、当前轮无图片且尚未产生流式事件时，移除内存历史图片并重试一次；持久化历史和当前轮图片保持不变。

- 2026-07-22T03:32:06.708Z Task created by Trellis automation.

## Verification Results
- 2026-07-22T07:08:17.552Z `真实 MiniMax 图片历史 -> DeepSeek deepseek-v4-flash 纯文本切换`: 通过：首次 image_url 反序列化拒绝触发兼容状态，移除历史图片后重试返回 OK；临时会话已删除。

- 2026-07-22T07:08:15.989Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；覆盖 OpenAI 兼容接口 unknown variant image_url, expected text 的历史图片降级识别。
- 2026-07-22T06:32:38.049Z `真实 MiniMax 图片历史 -> OpenRouter Nemotron 纯文本切换`: 历史图片 404 已触发兼容状态并进入无历史图片重试；重试请求不再报视觉错误，最终由上游返回 502 ResourceExhausted，真实错误按设计透传；临时会话已删除。

- 2026-07-22T06:32:37.288Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；新增 OpenRouter No endpoints found that support image input 错误模式回归断言通过。
- 2026-07-22T03:39:40.336Z `真实 MiniMax 图片历史 -> Silicon DeepSeek-V4-Flash 纯文本切换`: 通过：图片轮返回 OK；文本轮检测到不支持视觉后发出兼容状态、移除历史图片重试并返回 OK；临时会话已删除。

- 2026-07-22T03:39:39.542Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests::maps_image_blocks_to_each_provider_protocol；npm run typecheck；rustfmt --check；git diff --check`: 通过：四协议图片映射 1/1、TypeScript、Rust 格式和差异检查均通过；仅仓库既有 dead_code/linker warnings。
- 2026-07-22T03:39:38.723Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::runtime`: 通过：8/8；覆盖历史图片视觉拒绝重试、当前图片保护、非视觉错误和已产生事件不重试。

## Completion Summary
- 2026-07-22T07:08:39.339Z 补充 DeepSeek/OpenAI兼容接口对历史 image_url 消息块反序列化失败的识别；当前轮纯文本时自动移除历史图片重试，真实 DeepSeek V4 Flash 回归成功。

- 2026-07-22T06:32:51.277Z 补充 OpenRouter 无图片端点 404 的视觉拒绝识别；真实回归确认历史图片会被降级并进入纯文本重试，后续 NVIDIA 502 容量错误保持真实透传。
- 2026-07-22T03:39:50.813Z 修复普通聊天切换文本模型后被历史图片阻断：仅在上游明确拒绝视觉且当前轮无图片、尚未输出时，移除本次运行内存中的历史图片重试一次；当前图片、持久化历史、非视觉错误和 Agent 链路保持不变。定向测试与真实 Silicon 回归通过。

## Follow-ups

- 后续可以为模型目录增加显式视觉能力元数据，在请求前给出更早的能力提示；本次不依赖不可靠的模型名称推断。
