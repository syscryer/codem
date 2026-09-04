# Task: 修复 CCSwitch codex 渠道 bearer_token 导入丢失

## Background

用户反馈 ccswitch 中「星辰AI-codex特惠」没有出现在 CodeM 的外部渠道导入列表。排查确认（本机 `~/.cc-switch/cc-switch.db` 实测）：

- 该渠道 `app_type='codex'`，TOML `config` 解析正常、`model_providers.custom.base_url` 非空，但 `auth.OPENAI_API_KEY` 为 JSON `null`（该渠道在 ccswitch 挂过 ChatGPT OAuth，auth 区只留 tokens）。
- 中转站 key 实际存在 TOML `model_providers.<provider_key>.experimental_bearer_token` 中；ccswitch codex 渠道的 key 字段实际分布仅 `auth.OPENAI_API_KEY` 与 `experimental_bearer_token` 两种。
- CodeM `parse_ccswitch_codex` 只读 `auth.OPENAI_API_KEY`，得到空 key。
- `scan_response` 在构建列表前用 `filter(|c| !c.api_key.trim().is_empty())` 把空 key 渠道整体丢弃，导致：
  - 带 bearer_token 的渠道（星辰AI-codex特惠、agentrouter、api.justwoker.icu）完全不可见；
  - `parse_ccswitch_codex` 中"OAuth 登录凭据不支持导入"的 unavailable_reason 标记永远到不了前端（死逻辑）；OAuth 官方渠道（OpenAI Official ×3）也整体不可见，用户无法分辨"没检测到"与"存在但不可导入"。

## Objective

ccswitch 的 codex 渠道把中转站 key 存在 TOML experimental_bearer_token 时，CodeM 导入扫描读不到且被空 key 过滤静默丢弃；补回退读取并让带原因的不可导入渠道以灰条展示。

## Scope

In scope:

- `src-tauri/src/provider_import.rs`：
  - `parse_ccswitch_codex`：`auth.OPENAI_API_KEY` 为空/null 时回退读 `model_providers.<provider_key>.experimental_bearer_token`。
  - `scan_response`：空 key 过滤条件放宽为「api_key 非空 或 unavailable_reason 非空」，带原因的渠道进入列表（前端已有灰条 + reason 展示，`importable` 判定不变）。
- 补 parse 层单元测试（bearer_token 回退、OAuth 不可导入标记）。

Out of scope:

- claude / opencode 渠道解析逻辑（claude 空壳渠道如 Claude Official 无 key 无 tokens，继续被过滤，无展示价值）。
- Cherry Studio 导入解析本身（共用 `scan_response`，行为随灰条放宽自然一致）。
- 前端弹窗改动（灰条展示能力已存在）。

## Impact

- backend：`src-tauri/src/provider_import.rs`（导入扫描 API 行为，无 DB schema 变化）。
- 用户体验：导入列表新增若干灰条渠道（OpenAI Official OAuth、Claude Official 空壳等，显示不可导入原因），带 bearer_token 的中转渠道恢复可导入。

## Acceptance Criteria

- [ ] `parse_ccswitch_codex`：`auth.OPENAI_API_KEY` 为 null/空、TOML 含 `experimental_bearer_token` 时，api_key 取 bearer_token，渠道 importable。
- [ ] `parse_ccswitch_codex`：无任何 key 但 `auth.tokens` 存在时，仍标记"OAuth 登录凭据不支持导入"。
- [ ] `scan_response`：api_key 为空但带 unavailable_reason 的渠道保留在列表（灰条），不参与勾选导入。
- [ ] 本机实测：星辰AI-codex特惠出现在 codex tab 且可导入；OpenAI Official 渠道以灰条出现。
- [ ] `cargo test provider_import` 通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml provider_import`

## Implementation Record
- 2026-09-04T06:58:43.935Z 实现：1) parse_ccswitch_codex 在 auth.OPENAI_API_KEY 为 null/空时回退读 TOML model_providers.<key>.experimental_bearer_token（auth key 优先）；2) scan_response 空 key 过滤放宽为『api_key 非空或 unavailable_reason 非空』，OAuth/缺 key 渠道保留灰条展示而非静默消失，apply 侧既有 unavailable_reason 拦截保证灰条不可导入；3) 更新 scan_response_never_serializes_api_key_plaintext 断言（Missing Key 渠道保留灰条）、新增 parses_ccswitch_codex_bearer_token_fallback_and_oauth_reason（bearer 回退/优先级/OAuth reason）。前端无需改动，弹窗已有灰条+reason 展示

- 2026-09-04T06:55:16.651Z Task created by Trellis automation.

## Verification Results
- 2026-09-04T06:58:44.400Z `cargo test --manifest-path src-tauri/Cargo.toml provider_import`: 5 passed / 0 failed（含新增 bearer_token 回退与灰条保留用例）；另用本机 ~/.cc-switch/cc-switch.db 按【新逻辑端到端对账：codex 可导入 15→18 条（星辰AI-codex特惠/agentrouter/api.justwoker.icu 恢复），OpenAI Official×3 以 OAuth 灰条展示】

## Completion Summary
- 2026-09-04T06:58:52.595Z 修复 CCSwitch codex 渠道导入丢失：parse_ccswitch_codex 补 experimental_bearer_token 回退（auth.OPENAI_API_KEY 优先）；scan_response 空 key 过滤放宽，带 unavailable_reason 的渠道保留灰条展示。测试 5 passed；本机数据库对账 codex 可导入 15→18（星辰AI-codex特惠等 3 条恢复），OpenAI Official×3 显示 OAuth 灰条。当前无运行中 dev 服务，下次启动生效

## Follow-ups

- 待补充。
