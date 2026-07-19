# Task: 普通聊天能力开关

## Background

普通聊天复用了 Composer 的上下文工具入口，当前会加载并注入本机 Skills；该能力容易与 Agent Skills 混淆，也不符合普通聊天只使用供应商 API 的定位。普通聊天同时缺少用户可控的模型思考和供应商原生联网搜索入口。

## Objective

移除普通聊天 Skills，新增按模型持久化的思考和联网搜索开关，并按供应商协议真实映射请求能力

## Scope

In scope:

- 从普通聊天 bootstrap、前端状态、Composer 入口和运行 prompt 中移除 Skills。
- 增加普通聊天专属的“思考”和“联网搜索”开关，并为思考提供模型可用的等级选择。
- 开关按供应商与模型保存，切换模型后恢复该模型自己的选择，新聊天沿用对应模型上次选择。
- 后端按 OpenAI Responses、OpenAI Chat、Anthropic Messages、Gemini Generate Content 协议映射真实请求参数或工具。
- 对不支持的组合明确禁用，不影响知识库、MCP 和附件能力。

Out of scope:

- 不移除或调整 Agent 的 Skills、MCP、插件能力。
- 不引入 CodeM 托管的搜索服务、搜索 API Key 或网页抓取器。
- 不追溯删除旧数据库中的 selected_skills_json 字段，仅停止普通聊天使用并保持兼容读取。

## Impact

- Frontend: Composer、普通聊天 workspace/hook/API/types 与主题样式。
- Backend: ordinary_chat 请求类型、运行时、供应商协议 payload 和回归测试。
- Persistence: 新增普通聊天按模型偏好存储，旧会话和旧 Skills 字段继续兼容。

## Acceptance Criteria

- [ ] 普通聊天 Composer 不再显示 Skills 按钮，bootstrap 不再扫描普通聊天 Skills，运行时不再注入 Skill 文本。
- [ ] 思考与联网搜索开关使用 CodeM 现有 token，状态、禁用态和 tooltip 清晰；思考开启后可选择该模型支持的等级。
- [ ] 开关按 provider/model 独立持久化，切换模型和重启应用后可恢复。
- [ ] 支持的协议发送真实思考/搜索参数；不支持时不会发送无效字段。
- [ ] 普通聊天知识库、MCP、附件、流式输出和 Agent 运行不回归。
- [ ] 前端类型检查、相关 Node 测试、Rust 定向测试和真实页面验证通过。

## Verification Commands

- `npm run typecheck`
- `node --test --import tsx src/lib/ordinary-chat-*.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat`
- Playwright 普通聊天 Composer 交互与视觉检查

## Implementation Record
- 2026-07-19T04:20:25.690Z 完成普通聊天能力开关：移除普通聊天 Skills 扫描/注入，新增按模型持久化的思考开关、低/中/高/极高等级和供应商原生联网搜索；Agent Skills/MCP 逻辑保持不变。

- 2026-07-19T03:46:04.291Z Task created by Trellis automation.

## Verification Results

- 2026-07-19T04:20:27.008Z `git diff --check`: 通过，无空白错误
- 2026-07-19T04:20:26.685Z `cargo test --manifest-path src-tauri/Cargo.toml --target-dir target/codem-test ordinary_chat --no-fail-fast`: 43 个测试全部通过

- 2026-07-19T04:20:26.347Z `node --test --import tsx src/lib/ordinary-chat-*.test.ts src/lib/thread-model-preferences.test.ts`: 26 个测试全部通过
- 2026-07-19T04:20:26.010Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-19T04:20:35.538Z 普通聊天已移除 Skills 运行链路，新增按模型保存的思考开关与思考等级、供应商原生联网搜索，并完成前后端协议映射、禁用态、历史兼容和回归验证。

## Follow-ups

- 后续可基于供应商模型元数据扩充更精细的模型能力目录；本次以协议与已知供应商能力守住兼容边界。
