# Session Record: Claude 渠道支持 Fable 模型槽位

- Session: session-20260819-071619-xrlj
- Started: 2026-08-19T07:16:19.959Z
- Task: .trellis/tasks/claude-fable-model-slot.md

## Notes
- 2026-08-19T07:22:39.142Z 实现完成：backend.rs configured_model_options 增加 Fable 槽位（读 ANTHROPIC_DEFAULT_FABLE_MODEL，默认别名 fable，含 fable[1m] 与 1M 能力，描述标注需新版 Claude Code）；normalize_default_model_id 白名单加 fable/fable[1m]；can_use_context_1m_alias 加 fable 子串；前端 CLAUDE_MODEL_SLOT_VALUES 加 fable/fable[1m]，claude-model-selection 与 settings-api 归一化自动生效。移动端 sanitize_claude_model_catalog 为通用透传无需改动；composer-context-usage 的窗口判断所有分支同值无需改动

- 2026-08-19T07:16:19.963Z Session started.

## Verification

- 2026-08-19T10:26:30.691Z `npm run desktop:dev 重启 + desktop.log 端口检查`: 桌面开发壳已用新二进制重启（codem.exe 运行中，后端动态端口需 Bearer token，外部 curl 验证不可行，改由 configured_model_options 单测覆盖运行时输出）
- 2026-08-19T10:26:30.229Z `cargo test --lib configured_model_options_exposes_fable_slot / cargo test --lib`: 新增 configured_model_options_exposes_fable_slot 结构单测通过（fable 槽位存在、别名/1M 后缀正确）；全量 570 个后端测试通过

- 2026-08-19T07:22:44.104Z `cargo test --lib`: 569 个后端测试全部通过（1 ignored 为既有），含新增 model_settings_default_model_id_keeps_fable_slots
- 2026-08-19T07:22:43.671Z `node --import tsx --test src/lib/claude-model-selection.test.ts src/lib/claude-model-options.test.ts src/lib/settings-api.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-model-catalog-cache.test.ts src/lib/agent-channel-selection.test.ts`: 63 个前端测试全部通过，含新增 fable 槽位选择/回退与 normalizeModelSettings 保留 fable 默认模型用例

## Completed

- 2026-08-19T10:27:19.720Z cc 渠道模型体系对齐 claude CLI 2.1.232 的 Fable 档位：后端 configured_model_options 增加 Fable 槽位（读 ANTHROPIC_DEFAULT_FABLE_MODEL，默认别名 fable，含 fable[1m] 1M 切换），normalize_default_model_id 白名单与 can_use_context_1m_alias 补 fable；前端 CLAUDE_MODEL_SLOT_VALUES 补 fable/fable[1m]。新增 5 个测试（前端 3 个选择/归一化用例 + 后端 2 个单测），前端 63 个相关测试与后端 570 个测试全部通过，桌面开发壳已用新二进制重启待用户验收
