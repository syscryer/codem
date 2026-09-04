# Session Record: 接入 Qwen Code（ACP）

- Session: session-20260903-173310-w2b3
- Started: 2026-09-03T17:33:10.514Z
- Task: .trellis/tasks/qwen-code-acp-provider.md

## Notes
- 2026-09-03T17:45:52.065Z Qwen Code ACP 接入完成（代码层）：0.23.0 实测 initialize 握手通过（--acp 同 gemini-cli 系），session/new 返回结构化鉴权错误（Authentication required + authMethods——qwen-oauth/openai/anthropic/gemini/vertex 多鉴权），未登录属用户侧前置。接入实现照 Gemini/Kimi 模板：常量/注册表（10 providers）/能力声明（同 gemini-cli 系保守值：流式/审批/取消 Supported，images/MCP 待登录实测 Unsupported）/命令解析（PATH+QWEN_CLI_PATH+npm 兜底）/acp_arguments(--acp)/set_model/configOptions 模型目录/诊断(--version)/npm 包名/四处白名单/前端全套（metadata/图标（自绘同心圆）/三处 Record/契约 10）。后端 592+16+21、前端 lib+hooks、typecheck 全过。

- 2026-09-03T17:33:10.523Z Session started.

## Verification

## Completed
