# Session Record: 接入 Qwen Code（ACP）

- Session: session-20260904-100513-in7n
- Started: 2026-09-04T10:05:13.466Z
- Task: .trellis/tasks/qwen-code-acp-provider.md

## Notes

- 2026-09-04T11:58:50.720Z Qwen Code 三项缺口补齐：(1) 权限模式 set_mode 映射（default→default、auto→auto、bypassPermissions→yolo，Qwen ACP 5 模式中的三档对齐 CodeM）；(2) acp_arguments 动态传 --auth-type anthropic（渠道 env QWEN_CODE_AUTH_TYPE=anthropic 时附加，系统默认时不传让 CLI 自动检测本地认证）；(3) 系统渠道探测 read_qwen_system_channel（读 ~/.qwen/settings.json 的 auth.type + 环境变量 ANTHROPIC_BASE_URL 作为 base_url）。cargo 593+16+21、typecheck、lib 全过。
- 2026-09-04T10:40:07.715Z Qwen Code 渠道环境注入补齐：build_runtime match 补 QWEN_CODE_PROVIDER_ID 分支——注入 ANTHROPIC_BASE_URL/API_KEY + OPENAI_BASE_URL/API_KEY + QWEN_CODE_AUTH_TYPE=anthropic（Qwen 是 gemini-cli 系 CLI，原生读这些环境变量），支持三种通用协议。同时修复 CodeM API 直测 400 认证问题（之前环境未传递）。端到端探测确认：Qwen ACP + MiniMax anthropic 端点——token 级流式（chunks 多帧 spread 0.2s）、会话恢复正常（暗号答对）、configOptions 有 mode+model、set_config_option model 可用（需 string value 格式修正）。

- 2026-09-04T10:11:45.766Z P2 补齐：AgentProviderSettings defaultAgentProviderName 补 Kimi Code/Qwen Code 显示名；agent-provider-management 补安装文档 URL（kimi GitHub/qwen 官网）与 CLI 状态行（与 Hermes/DSH 同款'运行时可用/未检测到 CLI'口径）；agent_mux skill_install_targets 补 ~/.kimi-code/skills 和 ~/.qwen/skills（数组 7→9）。cargo 593+16+21、typecheck、管理 UI 契约测试、fmt --check 全过。
- 2026-09-04T10:05:13.933Z Codex review 五项修复：(P1-#1) lifecycle plan 补 Qwen npm 安装分支，设置页诊断/安装/更新不再 400；(P1-#2) agent_channels 四处补 Qwen（validate_provider_id/validate_protocol（三种通用协议）/修复列表/import），前端渠道展示与后端校验对齐；(P1-#3) 模型目录从 initialize.models 改为 session configOptions（qwen_acp_model_catalog 正式接线），set_model 改为 set_config_option 与 configOptions 目录一致，空目录时报认证指引；(P1-#4) cargo fmt 全仓修复（含并行 CCSwitch 任务的 provider_import.rs）；(P2 部分) useAgentRun 渠道目录判断补 Qwen。全量通过：cargo 593+16+21、lib/hooks/provider_import 专项、typecheck、build、fmt --check。P2 余项（Agent Mux 固定列表/Skill 安装目标/CLI provider 映射/设置页认证面板）列 Follow-up。

- 2026-09-04T10:05:13.468Z Session started.

## Verification
- 2026-09-04T10:05:14.380Z `cargo test; npm run typecheck; npm run build; cargo fmt --check; node --import tsx --test src/lib/*.test.ts src/hooks/*.test.ts tests/provider-import*.test.ts`: cargo 593+16+21 passed；typecheck 通过；build 通过；fmt --check 通过；lib+hooks+provider_import 专项全过。

## Completed
