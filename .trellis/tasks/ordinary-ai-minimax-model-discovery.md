# Task: 修正 MiniMax Token Plan 模型发现

## Background

MiniMax Token Plan 模型选择器只显示一个模型。当前实现把 MiniMax 视为没有模型列表接口并固定返回 `MiniMax-M2.7`，但官方 Anthropic 兼容接口实际提供 `GET /anthropic/v1/models`；现有通用 Anthropic 地址拼接还会错误生成 `/anthropic/models`。

## Objective

使用官方 /anthropic/v1/models 接口发现完整模型，并在无密钥时展示官方文档候选

## Scope

In scope:

- 修正 Anthropic 模型列表地址，根地址、`/v1`、MiniMax `/anthropic` 和完整 action 地址均生成正确的 `/v1/models`。
- MiniMax Token Plan 已填写 API Key 时请求官方模型列表，返回账户实际可用模型。
- 未填写 API Key 时展示官方文档列出的完整 MiniMax 模型候选，不再只有一个模型。
- 测试连接优先使用实际发现到的模型，避免固定模型过时。
- 保持其他没有标准模型列表的 Coding/Token Plan 使用已确认的内置候选。

Out of scope:

- 不猜测官方文档未列出的模型。
- 不把远程请求失败伪装成模型发现成功。
- 不保存或回显 API Key。

## Impact

- Backend：Anthropic 模型列表 URL 归一化、MiniMax Token Plan 模型发现策略和测试覆盖。
- Frontend：无需新增协议字段，模型选择器直接消费后端返回的完整列表。

## Acceptance Criteria

- [x] MiniMax `/anthropic` 正确请求 `/anthropic/v1/models`，标准 Anthropic 正确请求 `/v1/models`。
- [x] MiniMax Token Plan 无 API Key 时显示官方支持的多个模型候选。
- [x] 有 API Key 时使用官方接口返回的真实模型列表，不被内置候选覆盖。
- [x] 普通 Anthropic、其他 Token Plan 和模型多选流程不回归。
- [x] Rust 测试、前端测试、生产构建和运行接口验证通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts src/lib/composer-keyboard.test.ts`
- `npm run build`
- `git diff --check && git diff --cached --check`
- 运行后端验证 MiniMax 无密钥模型发现返回多个模型。

## Implementation Record
- 2026-07-14T06:03:48.742Z 修正 Anthropic 模型列表地址为 /v1/models；MiniMax Token Plan 在无 API Key 时返回官方文档中的 8 个候选，有 Key 时请求 /anthropic/v1/models；已保存供应商模型发现改为可选读取密钥，普通供应商仍要求 API Key。

- 2026-07-14T05:36:05.373Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T06:06:44.443Z `Runtime API and git hygiene`: pass: draft MiniMax discovery returned 8 models; git diff checks passed; sensitive key scan had no matches

- 2026-07-14T06:06:34.222Z `Playwright: Settings > AI Providers > MiniMax Token Plan > Get model list`: pass: dialog shows 8 models; 7 unadded models can be selected together
- 2026-07-14T06:04:20.806Z `npm run build`: pass: TypeScript and Vite production build completed

- 2026-07-14T06:04:11.382Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts src/lib/composer-keyboard.test.ts`: pass: 7 passed, 0 failed
- 2026-07-14T06:04:02.624Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: pass: 36 passed, 0 failed

## Completion Summary
- 2026-07-14T06:07:30.613Z MiniMax Token Plan 模型发现已修正：无 API Key 时展示 8 个官方候选，有 Key 时请求官方 /anthropic/v1/models；已保存供应商无 Key 不再被提前拦截。Rust、前端测试、构建、运行接口和 Playwright 多选验收全部通过。

## Follow-ups

- 无。
