# Task: 修复普通聊天知识库感知

## Background

普通聊天已选择知识库时，运行时只在本轮 RAG 检索分数超过阈值后注入知识片段。用户询问“可以看到知识库吗”这类元问题时，问题文本与库内业务配置没有词面重合，检索返回空，模型因此错误声称没有知识库；实际所选知识库已有来源和分块。

## Objective

让模型始终知道当前已选知识库，并在用户明确询问知识库但检索零命中时获得受限代表片段，避免错误声称没有知识库

## Scope

In scope:

- 始终向模型注入当前已选知识库的名称、描述、来源和分块数量。
- 用户明确询问知识库且正常检索零命中时，为每个已选知识库提供受总长度限制的代表片段。
- 正常有检索命中时继续使用现有 RAG 片段，不重复注入代表内容。
- 增加知识库上下文和零命中行为测试。

Out of scope:

- 不改变知识库选择 UI、检索阈值、分块和本地 embedding 算法。
- 不把整个知识库注入每一轮，也不引入外部 embedding 服务。
- 不在无关的零命中对话中把知识库正文发送给外部模型。
- 不调整 MCP、Skills 或 Agent 上下文。

## Impact

- Backend: `ordinary_chat/knowledge.rs` 增加已选库上下文读取；`ordinary_chat/runtime.rs` 统一构造知识库系统消息。
- Frontend/API/Persistence: 无数据结构和接口变化。

## Acceptance Criteria

- [x] 选中知识库后，即使本轮检索零命中，模型也能看到所选库名称和来源状态。
- [x] 明确询问知识库且零命中时，代表片段有单库和总字符上限，避免上下文无界增长。
- [x] 无关的零命中对话只注入元数据，不注入知识库正文预览。
- [x] 有命中时保持现有引用片段和 citations 行为。
- [x] 未选择知识库时不增加系统消息。
- [x] 普通聊天知识库和运行时定向测试通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::knowledge --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::runtime --lib`
- `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/knowledge.rs src-tauri/src/ordinary_chat/runtime.rs`
- `git diff --check`

## Implementation Record
- 2026-07-19T07:56:43.455Z 已将普通聊天的知识库选择元数据与本轮检索命中拆分；始终注入名称、描述、来源和分块状态，仅在用户明确询问知识库且零命中时注入受限代表片段。

- 2026-07-19T07:41:57.761Z Task created by Trellis automation.
- 运行时将“已选择知识库”与“本轮检索命中”拆分：始终注入元数据，命中时保留原有 citations，仅在知识库元问题零命中时注入受限预览。
- 知识库预览限制为单库最多 900 字、总计最多 2400 字，控制上下文大小和外发范围。

## Verification Results
- 2026-07-19T08:00:11.920Z `最终定向回归：knowledge 5/5，runtime 4/4`: 通过：补充未选择知识库和 citations 保留断言后，两组测试再次全部通过。

- 2026-07-19T07:56:52.061Z `桌面开发版真实普通聊天验证`: 通过：DeepSeek 临时聊天选择知识库 11111 后，回答能识别知识库名称、1 个来源和受限内容概览；临时聊天已删除，后端健康检查正常。
- 2026-07-19T07:56:50.945Z `rustfmt --edition 2021 --check src-tauri/src/ordinary_chat/knowledge.rs src-tauri/src/ordinary_chat/runtime.rs && git diff --check`: 通过：Rust 格式与工作区 diff 检查无错误；仅有既有 LF/CRLF 提示。

- 2026-07-19T07:56:49.438Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::runtime --lib`: 通过：4 个 runtime 定向测试全部通过，包含零命中知识库感知与 RAG 关键词边界。
- 2026-07-19T07:56:47.898Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat::knowledge --lib`: 通过：5 个 knowledge 定向测试全部通过，包含元数据、来源名和预览长度上限。

## Completion Summary
- 2026-07-19T08:00:16.260Z 修复普通聊天已选择知识库但零检索命中时模型误判无知识库：始终注入所选库元数据，显式知识库元问题零命中时注入有界预览，保留原 citations 行为并完成真实 DeepSeek 会话验证。

## Follow-ups

- 后续如接入真正语义 embedding，可重新评估零命中代表片段策略。
