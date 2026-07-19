# Task: 修复普通聊天 MCP 流式参数归并

## Background

普通聊天通过 OpenAI Chat 流式接口调用 DeepSeek `deepseek-v4-flash` 时，模型返回的 MCP 工具名正确，但最终参数被判定为无效 JSON。真实 SSE 证据显示 DeepSeek 会把 JSON 参数拆成 `"202"`、`"5"` 等细粒度片段；这些片段单独也是合法 JSON 数字，旧归并逻辑因此误把它们当成完整参数快照并覆盖已累积内容。

## Objective

修复 OpenAI Chat 增量工具参数中的合法 JSON 标量片段误覆盖已累积参数，保证 DeepSeek 等供应商可稳定调用 MCP

## Scope

In scope:

- 修正普通聊天供应商流式工具参数的快照识别规则。
- 保留 OpenAI Responses、Gemini 等协议发送完整对象快照时的覆盖兼容。
- 增加 DeepSeek 数字标量分片和完整对象快照回归测试。
- 使用本地已配置 DeepSeek 渠道和 `web-search-prime` MCP 做一次临时聊天真实链路验证。

Out of scope:

- 不调整 MCP 服务配置、协议传输、审批和工具结果展示。
- 不改普通聊天历史、知识库、思考开关或 Agent 的 MCP 链路。
- 不把不完整或确实错误的工具参数静默修补为其他 JSON。

## Impact

- Backend: `src-tauri/src/ordinary_chat/provider.rs` 的工具参数流归并和定向测试。
- Persistence/API/Frontend: 无契约或数据结构变化。

## Acceptance Criteria

- [x] JSON 数字、字符串、布尔值或 null 形式的增量片段不会覆盖已累积参数。
- [x] 完整 JSON 对象快照仍可替换此前的不完整参数。
- [x] DeepSeek OpenAI Chat 真实请求可完成 MCP 工具调用并收到最终回答。
- [x] provider 定向测试、当前文件 rustfmt 和 diff 检查通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::provider::tests --lib`
- `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/provider.rs`
- `git diff --check`
- 临时普通聊天：DeepSeek `deepseek-v4-flash` -> `web-search-prime` -> MCP 工具结果 -> 最终 `done`，完成后删除临时聊天。

## Implementation Record
- 2026-07-19T07:11:26.045Z 确认根因：OpenAI Chat 增量工具参数中的 202、5 等标量片段被旧逻辑误当作完整 JSON 快照，覆盖已累积对象。已改为仅完整 JSON 对象可触发快照覆盖，并保留增量拼接。

- 2026-07-19T07:01:17.536Z Task created by Trellis automation.

## Verification Results
- 2026-07-19T07:12:26.198Z `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/provider.rs && git diff --check`: 通过：当前 provider 文件格式正确，diff 无空白错误；全仓 cargo fmt 仍有本次范围外既有文件格式差异，未修改

- 2026-07-19T07:12:10.140Z `DeepSeek deepseek-v4-flash -> web-search-prime MCP -> tool-result -> done 临时聊天`: 通过：真实 MCP 工具调用与最终回答完成，无 JSON 参数错误；临时聊天已删除
- 2026-07-19T07:11:43.197Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::provider::tests --lib`: 通过：16 个普通聊天 provider 测试全部通过，包括 DeepSeek 标量分片、完整对象快照和四类协议工具调用解析

## Completion Summary
- 2026-07-19T07:12:42.485Z 修复普通聊天 OpenAI Chat MCP 参数归并：合法 JSON 标量分片不再误覆盖累积参数，完整对象快照兼容保留；DeepSeek 真实 MCP 链路和 provider 回归测试通过。

## Follow-ups

- 无。
