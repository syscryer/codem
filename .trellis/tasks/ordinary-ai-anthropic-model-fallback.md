# Task: 修复 Anthropic 兼容供应商模型发现

## Background

DeepSeek 的 Anthropic 兼容聊天入口为 `https://api.deepseek.com/anthropic`，但模型列表位于 `https://api.deepseek.com/models`。普通聊天当前固定从 Anthropic 基址派生 `/v1/models`，导致连接测试和模型获取返回 HTTP 404，实际 `/v1/messages` 聊天接口可以正常调用。

## Objective

支持 DeepSeek Anthropic 兼容地址使用独立模型列表端点，修复连接测试与模型获取 404

## Scope

In scope:

- 为 Anthropic 兼容基址生成模型列表候选地址。
- 兼容 `/anthropic` 等常见聊天子路径，404/405 时继续尝试剥离子路径后的 `/v1/models` 和 `/models`。
- 为回退地址同时发送 Anthropic Key 和 Bearer 鉴权，兼容根路径 OpenAI 风格模型接口。
- 增加端点生成和真实回退流程的 Rust 回归测试。

Out of scope:

- 不修改 Agent 与模型设置或 Agent 请求链路。
- 不修改普通聊天消息发送端点和协议转换。
- 不将测试 API Key 写入代码、任务记录、日志或数据库。

## Impact

- `src-tauri/src/ordinary_chat/provider.rs`
- 普通聊天供应商的连接测试与模型发现。

## Acceptance Criteria

- [ ] `https://api.deepseek.com/anthropic` 的模型候选包含根路径 `https://api.deepseek.com/models`。
- [ ] 子路径模型接口返回 404 时可以继续回退并解析根路径模型列表。
- [ ] 401、403 等鉴权错误仍直接返回，不用候选回退掩盖。
- [ ] 普通 Anthropic 与现有 Token Plan 行为不回归。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`

## Implementation Record
- 2026-07-14T10:50:32.320Z 确认 DeepSeek Anthropic 聊天端点 /anthropic/v1/messages 返回 200，而 /anthropic/v1/models 返回 404、根 /models 返回 200；按 CC Switch 增加兼容子路径模型端点候选与 404/405 回退。

- 2026-07-14T10:48:36.548Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T10:54:22.173Z `POST /api/ai/providers/probe (DeepSeek Anthropic)`: 通过，返回连接成功并发现 2 个模型；Key 未写入仓库

- 2026-07-14T10:54:21.317Z `git diff --check`: 通过，仅有现有 Windows LF/CRLF 提示
- 2026-07-14T10:54:20.481Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

- 2026-07-14T10:54:19.583Z `cargo check --manifest-path src-tauri/Cargo.toml`: 通过
- 2026-07-14T10:54:18.684Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`: 13 项通过，0 失败

## Completion Summary
- 2026-07-14T10:54:33.033Z 修复 Anthropic 兼容供应商模型发现：子路径模型接口 404/405 时回退到剥离兼容路径后的 /v1/models 与 /models；DeepSeek Anthropic 通过 CodeM 实际探测并发现 2 个模型。

## Follow-ups

- 无。
