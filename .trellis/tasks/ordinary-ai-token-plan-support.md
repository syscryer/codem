# Task: 支持供应商 Token Plan 模式

## Background

普通聊天供应商模型发现默认请求标准 `/models` 接口，但部分 Coding/Token Plan 只开放消息接口，并通过套餐固定可用模型。MiniMax Anthropic Token Plan 因此在创建态测试和获取模型时返回 404，不能按普通供应商处理。

## Objective

支持没有标准模型列表接口的 Token Plan 供应商，尤其是 MiniMax Anthropic Token Plan 的连接测试、模型候选和多选添加

## Scope

In scope:

- 为常见 Coding/Token Plan 提供独立模板，并保持在统一厂商列表中可搜索。
- MiniMax、Kimi、智谱和 Qwen Coding/Token Plan 使用内置模型候选，不请求不存在的 `/models`。
- 创建态无需 API Key 即可打开内置模型列表并多选；测试连接仍必须提供 API Key。
- Token Plan 连接测试根据供应商协议请求实际 Anthropic Messages 或 OpenAI Chat Completions 接口。
- 普通远程模型发现仍要求 API Key，并继续请求供应商模型列表。
- 错误响应继续经过敏感信息脱敏，不记录或回显 API Key。

Out of scope:

- 不内置低频、来源不明确的 Token Plan 供应商。
- 不实现套餐额度查询、余额统计或购买流程。
- 不自动持久化全部内置模型，仍由用户多选确认。

## Impact

- Backend：供应商模板、模型发现分流和连接测试策略。
- Frontend：创建态模型发现允许 Token Plan 在未填写 API Key 时读取内置候选。
- Security：测试密钥只用于单次外部请求，不进入数据库、日志或响应。

## Acceptance Criteria

- [x] MiniMax Token Plan 使用 `https://api.minimaxi.com/anthropic` 和 Anthropic Messages 协议。
- [x] MiniMax、Kimi、智谱和 Qwen Coding/Token Plan 均有可搜索的内置模板和模型候选。
- [x] Token Plan 获取模型列表不请求 `/models`，创建态可搜索、多选和批量添加。
- [x] Token Plan 测试连接调用实际消息接口，并使用最小输出请求验证鉴权与模型可用性。
- [x] 普通供应商模型发现仍要求 API Key，不受 Token Plan 分流影响。
- [x] 前后端回归、生产构建、差异检查和浏览器交互验证通过。

## Verification Commands

- `npm run build`
- `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts src/lib/composer-keyboard.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `git diff --check && git diff --cached --check`
- 浏览器验证 Token Plan 模板、协议、内置模型列表和多选添加。

## Implementation Record
- 2026-07-14T04:45:18.985Z 按常见 Token Plan 分流模型发现和连接测试：MiniMax、Kimi、智谱、Qwen 使用内置模型候选，不请求 /models；Anthropic 和 OpenAI Chat 均通过最小消息请求验证连接；创建态内置模型列表无需先填写 API Key。

- 2026-07-14T03:39:42.304Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T04:55:04.863Z `浏览器与运行后端复验`: 通过：浏览器已验证 MiniMax Token Plan 模板、Anthropic 协议、内置模型选择器和多选添加；运行后端返回 MiniMax、Kimi、智谱、Qwen 四个模板及对应内置模型

- 2026-07-14T04:55:04.055Z `git diff --check && git diff --cached --check`: 通过：工作区与暂存区无空白错误
- 2026-07-14T04:55:03.258Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: 通过：35 项 ordinary_chat Rust 测试，包含四类 Token Plan 模型发现与消息探测

- 2026-07-14T04:55:02.392Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts src/lib/composer-keyboard.test.ts`: 通过：7 项前端设置、搜索和键盘契约测试
- 2026-07-14T04:55:01.536Z `npm run build`: 通过：TypeScript 检查与 Vite 生产构建成功

## Completion Summary
- 2026-07-14T04:55:16.477Z 完成普通聊天 Token Plan 支持：统一厂商列表新增 MiniMax、Kimi、智谱和 Qwen Coding/Token Plan 模板；使用内置模型候选避免无效 /models 请求；创建态可直接多选模型；连接测试按 Anthropic 或 OpenAI Chat 发送最小消息验证；完整构建、35 项 Rust 测试、7 项前端测试、差异检查和界面/API 复验均通过。

## Follow-ups

- 后续新增 Token Plan 时，必须先确认公开协议、固定模型和消息测试端点，再加入内置路由表。
