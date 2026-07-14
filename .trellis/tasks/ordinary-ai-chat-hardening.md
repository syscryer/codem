# Task: 普通 AI 聊天最终加固

## Background

普通 AI 聊天完整链路已经实现并通过功能验收。用户要求继续完善，因此在不触碰主工作区尚未提交的设置页改动前提下，再做一次代码级加固审计，重点寻找正常烟测不容易暴露的异常、竞态、资源泄漏和敏感信息边界问题。

## Objective

审计并修复普通聊天的异常边界、并发状态、资源清理、安全脱敏和可维护性问题，不修改并行设置页

## Scope

In scope:

- 审计 `src-tauri/src/ordinary_chat/**` 的 Provider、MCP、运行循环、持久化、知识库和密钥处理。
- 审计 `useOrdinaryChat`、普通聊天 workspace、Composer 和消息操作的多会话并发状态。
- 检查 TODO、占位实现、静默回退、未限制输入、未清理任务和错误信息泄漏。
- 对确认的问题进行局部修复并补充针对性测试。
- 重新运行 Rust、TypeScript、前端回归和差异门禁。

Out of scope:

- 不修改主工作区尚未提交的设置页、Agent Provider、MCP/Plugins/Skills 设置实现。
- 不增加新的供应商协议、文档解析格式或多模型同时回答。
- 不进行无明确收益的大规模重构。

## Impact

- Backend：普通聊天运行、MCP/Provider 生命周期、错误和持久化边界。
- Frontend：普通聊天多会话运行状态、审批和消息动作。
- Security：密钥、工具结果、附件和知识库内容的脱敏边界。

## Acceptance Criteria

- [x] 普通聊天代码中不存在遗留 TODO、占位分支或静默协议回退。
- [x] Provider/MCP 子进程、HTTP session、审批等待和取消路径能够明确结束或清理。
- [x] 多普通聊天并发、切换、删除和审批不会串到其他 chat。
- [x] 错误、日志、历史和导出不会新增泄漏密钥、base64 或知识库全文的路径。
- [x] 发现的问题有针对性测试或可重复验证证据。
- [x] 最终 Rust、TypeScript、前端回归和 Git 差异检查通过。

## Verification Commands

- `rg` 静态审计普通聊天前后端代码。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`，若仅有仓库既有告警则记录并使用定向检查。
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `npm run typecheck`
- 普通聊天相关前端测试。
- `git diff --check` 与 `git diff --cached --check`

## Implementation Record
- 2026-07-13T22:34:08.271Z 完成普通聊天最终加固：修复 Anthropic /v1 地址重复、运行前置校验失败留下 running 历史、前端重连失败 context 卡死和已结束运行记录永久占用内存；不修改主工作区设置页。

- 2026-07-13T22:18:52.444Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T22:34:11.984Z `隔离服务 5174/3101 健康检查`: 通过：最新 backend 监听 3101，Web 监听 5174，主工作区 5173/3001 未受影响

- 2026-07-13T22:34:11.265Z `安全扫描、git diff --check、git diff --cached --check`: 通过：无新增密钥/base64，工作区与暂存区差异检查通过
- 2026-07-13T22:34:10.547Z `过滤仓库既有告警后的 cargo clippy --lib -D warnings`: 通过：普通聊天新增代码无额外 Clippy 告警；全量严格 Clippy 仍被仓库既有 Agent/backend 告警阻断

- 2026-07-13T22:34:09.758Z `npm run typecheck && npm run build`: 通过：TypeScript 与生产构建成功，仅既有 chunk 提示
- 2026-07-13T22:34:09.015Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: 通过：24/24，新增 Anthropic URL 和缺少 API Key 不产生脏历史回归

## Completion Summary
- 2026-07-13T22:34:23.598Z 完成普通 AI 聊天最终加固：修复 Anthropic URL、前置校验脏历史、重连卡死和运行记录内存释放问题，新增针对性回归并通过 Rust/TS/build/Clippy/安全与服务验证。

完成普通聊天最终加固：修正 Anthropic Base URL 已包含 `/v1` 时重复拼接为 `/v1/v1/messages` 的协议错误；把 API Key、Skills 和知识库检索前置到历史写入之前，避免前置校验失败留下永久 running 消息；重连流失败时停止后端运行并清理前端上下文，避免聊天永久卡在运行态；已结束运行保留 5 分钟用于重连后自动从内存清理。MCP client 使用 boxed transport 降低枚举体积，知识库 token 估算使用标准 `div_ceil`。新增缺失 API Key 不产生脏历史和 Anthropic URL 归一化测试。

## Follow-ups

- 设置页薄嵌入等待主工作区设置改动形成可合并提交后处理。
