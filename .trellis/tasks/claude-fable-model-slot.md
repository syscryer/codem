# Task: Claude 渠道支持 Fable 模型槽位

## Background

claude CLI 2.1.232 原生支持新的 Fable 模型档位（本机 claude.exe 字符串验证）：

- `--model` 别名列表为 `["sonnet","opus","haiku","fable","best","sonnet[1m]","opus[1m]","fable[1m]","opusplan"]`
- 支持 `ANTHROPIC_DEFAULT_FABLE_MODEL` 环境变量（与 SONNET/OPUS/HAIKU 同构）
- 官方定位文案："Fable for the hardest problems, Opus for complex work, Sonnet for most tasks, Haiku for quick questions"，即 Fable 是最强档

CodeM 的 cc 渠道模型体系目前只有 sonnet/opus/haiku 三档，选不了 fable：

1. `configured_model_options()`（backend.rs）不读 `ANTHROPIC_DEFAULT_FABLE_MODEL`，模型下拉没有 Fable 槽位
2. `normalize_default_model_id`（backend.rs）槽位白名单不含 fable/fable[1m]，保存的默认模型会被重置回 `__default`
3. 前端 `CLAUDE_MODEL_SLOT_VALUES`（src/constants.ts）不含 fable，`isClaudeSlotModelId` 不认 fable 槽位
4. `can_use_context_1m_alias`（backend.rs）不含 fable 子串，`fable[1m]` 的 1M 能力判定会漏

导入侧（cc-switch 的 `ANTHROPIC_DEFAULT_FABLE_MODEL` 值收集，provider_import.rs:727）已支持，本次不动。

## Objective

对齐 claude CLI 2.1.232 的 fable/fable[1m] 模型别名与 ANTHROPIC_DEFAULT_FABLE_MODEL，让 cc 渠道模型选择器提供 Fable 槽位

## Scope

In scope:

- backend.rs `configured_model_options()` 增加 Fable 槽位：读 `ANTHROPIC_DEFAULT_FABLE_MODEL`（settings.json env 优先，其次进程环境变量），默认别名 `fable`，含 `fable[1m]`、supportsContext1m、context1mModel
- backend.rs `normalize_default_model_id` 槽位白名单加 `fable`/`fable[1m]`
- backend.rs `can_use_context_1m_alias` 加 fable 子串判断
- src/constants.ts `CLAUDE_MODEL_SLOT_VALUES` 加 `fable`/`fable[1m]`
- Fable 槽位描述文案标注需要新版 Claude Code
- 补充前端选择逻辑测试

Out of scope:

- 不加 CLI 也支持的 `best`、`opusplan` 等其它别名（后续按需）
- 不做 CLI 版本探测/按版本隐藏槽位（与现有 sonnet/opus/haiku 无条件展示的策略保持一致）
- 不读 `ANTHROPIC_DEFAULT_FABLE_MODEL_NAME`（CLI 的自定义显示名）
- 不改 cc-switch 导入逻辑（已支持）

## Impact

- `src-tauri/src/backend.rs`：configured_model_options / normalize_default_model_id / can_use_context_1m_alias
- `src/constants.ts`：CLAUDE_MODEL_SLOT_VALUES
- `src/lib/claude-model-selection.ts`：自动跟随常量，无需改动
- `src/lib/claude-model-selection.test.ts`：补 fable 用例
- 存量用户设置不受影响：没有保存过 fable 的用户无感知；保存过 fable（此前会被重置）的用户将正确保留

## Acceptance Criteria

- [x] cc 渠道模型下拉出现 Fable 槽位，未配置 `ANTHROPIC_DEFAULT_FABLE_MODEL` 时默认传别名 `fable`，配置了则显示"当前映射：<model>"（configured_model_options_exposes_fable_slot 单测覆盖）
- [x] Fable 槽位带 `fable[1m]` 1M 上下文切换（未禁用 1M 时，can_use_context_1m_alias 已含 fable）
- [x] 把默认模型保存为 `fable`/`fable[1m]` 后端归一化不再重置（model_settings_default_model_id_keeps_fable_slots 单测覆盖）
- [x] 选中 Fable 槽位运行时请求携带 `--model fable`（或映射后的真实模型）（前端 resolveRunModelSelection 用例覆盖 requestModel）
- [x] 旧版 CLI 场景不额外处理，但描述文案提示需要新版 Claude Code
- [x] 前端选择逻辑对 fable 槽位的回退/保留行为与 sonnet 一致（有测试覆盖）

## Verification Commands

- `node --import tsx --test src/lib/claude-model-selection.test.ts src/lib/claude-model-options.test.ts src/lib/settings-api.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-model-catalog-cache.test.ts src/lib/agent-channel-selection.test.ts`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --lib`
- 手动验收：桌面 dev 已重启（新二进制），在 cc 渠道模型下拉确认 Fable 项

## Implementation Record
- 2026-08-19T07:22:39.142Z 实现完成：backend.rs configured_model_options 增加 Fable 槽位（读 ANTHROPIC_DEFAULT_FABLE_MODEL，默认别名 fable，含 fable[1m] 与 1M 能力，描述标注需新版 Claude Code）；normalize_default_model_id 白名单加 fable/fable[1m]；can_use_context_1m_alias 加 fable 子串；前端 CLAUDE_MODEL_SLOT_VALUES 加 fable/fable[1m]，claude-model-selection 与 settings-api 归一化自动生效。移动端 sanitize_claude_model_catalog 为通用透传无需改动；composer-context-usage 的窗口判断所有分支同值无需改动

- 2026-08-19T07:16:19.961Z Task created by Trellis automation.

## Verification Results

- 2026-08-19T10:26:30.691Z `npm run desktop:dev 重启 + desktop.log 端口检查`: 桌面开发壳已用新二进制重启（codem.exe 运行中，后端动态端口需 Bearer token，外部 curl 验证不可行，改由 configured_model_options 单测覆盖运行时输出）
- 2026-08-19T10:26:30.229Z `cargo test --lib configured_model_options_exposes_fable_slot / cargo test --lib`: 新增 configured_model_options_exposes_fable_slot 结构单测通过（fable 槽位存在、别名/1M 后缀正确）；全量 570 个后端测试通过

- 2026-08-19T07:22:44.104Z `cargo test --lib`: 569 个后端测试全部通过（1 ignored 为既有），含新增 model_settings_default_model_id_keeps_fable_slots
- 2026-08-19T07:22:43.671Z `node --import tsx --test src/lib/claude-model-selection.test.ts src/lib/claude-model-options.test.ts src/lib/settings-api.test.ts src/lib/agent-model-selection.test.ts src/lib/agent-model-catalog-cache.test.ts src/lib/agent-channel-selection.test.ts`: 63 个前端测试全部通过，含新增 fable 槽位选择/回退与 normalizeModelSettings 保留 fable 默认模型用例

## Completion Summary
- 2026-08-19T10:27:19.720Z cc 渠道模型体系对齐 claude CLI 2.1.232 的 Fable 档位：后端 configured_model_options 增加 Fable 槽位（读 ANTHROPIC_DEFAULT_FABLE_MODEL，默认别名 fable，含 fable[1m] 1M 切换），normalize_default_model_id 白名单与 can_use_context_1m_alias 补 fable；前端 CLAUDE_MODEL_SLOT_VALUES 补 fable/fable[1m]。新增 5 个测试（前端 3 个选择/归一化用例 + 后端 2 个单测），前端 63 个相关测试与后端 570 个测试全部通过，桌面开发壳已用新二进制重启待用户验收

## Follow-ups

- 2026-08-19 对 2.1.235 原生二进制做了 cc 接入全面体检（CodeM cc 接入为 2026-05 所写）：spawn 参数（-p/--input-format stream-json/--include-partial-messages/--include-hook-events/--permission-prompt-tool/--fork-session/--effort/--settings/--resume 等）、流式事件契约（stream_event/system(api_retry)/assistant/user/result/control_request、isSidechain、content_block_*）、settings 键（apiKeyHelper/ultracode/env 块）、权限模式枚举（bypassPermissions/acceptEdits/dontAsk）、effort 枚举（low~max/ultracode）**全部仍然兼容，无 breaking change**；CLI 演进均为增量。新增 `immediate` effort 枚举值 CodeM 暂未提供，按需再加。
- CLI 还支持 `best`、`opusplan` 别名，目前未加入槽位，后续按需评估。（2026-08-19 已核实 2.1.235：行为与 2.1.232 一致——best 为账号策略动态解析别名，opusplan 为"计划模式 Opus、其余 Sonnet"路由别名，均非固定档位，不适合进普通槽位下拉。）
- 2.1.235 新增 `mythos` 档位，但为 Project Glasswing 邀请制预览（非参与者回落 Fable），官方描述表也未挂出；用户确认不接入，等 GA 后再对齐。
- 2.1.235 四个槽位均支持 `_MODEL_NAME/_DESCRIPTION/_SUPPORTED_CAPABILITIES` 扩展环境变量，且别名正则支持版本号后缀（如 `sonnet-5`）；CodeM 均暂不读取，边缘能力按需再补。
- `ANTHROPIC_DEFAULT_FABLE_MODEL_NAME`（CLI 自定义显示名）未读取，若用户有自定义显示名需求再补。
- 桌面壳后端使用动态端口 + Bearer token，外部 HTTP 验证不可行；运行时输出由 configured_model_options 单测覆盖。
