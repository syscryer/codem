# Task: 修复 DSH Alpha 版本检测与更新

## Background

DeepSeek DSH 已在 npm 的 `alpha` dist-tag 发布 `0.1.2-alpha.2`，但 CodeM 对预发布版本只读取 `latest` 与 `next`，因此本机 `0.1.1-rc.2` 被错误显示为“已是最新”。同时，现有 DSH 更新计划固定安装 `@next`，即使单独修正检测结果，点击更新也可能继续安装旧版本。

## Objective

让 CodeM 正确检测 DSH alpha 发布版本，并确保更新动作安装与检测结果一致的版本

## Scope

In scope:

- DSH 预发布版本查询同时识别 `latest`、`next` 与 `alpha`，并按语义版本选择最高版本。
- DSH 更新请求携带已展示的目标版本，后端严格校验后安装该精确版本，保证检测与更新一致。
- 保持其他 Agent 的 `latest` 查询和安装/更新行为不变。
- 补充 Rust 与 TypeScript 回归测试，并验证真实 npm dist-tags。

Out of scope:

- 不自动执行 DSH 更新，不修改用户的 DSH 配置、凭据或渠道。
- 不扩展到 beta/canary 等尚未观察到的 DSH 发布标签。
- 不调整 Agent 运行协议、会话、模型或能力声明。

## Impact

- Backend: `src-tauri/src/backend.rs` 的 npm dist-tag 解析、生命周期请求校验与 DSH 更新计划。
- Frontend contract: `src/lib/agent-provider-registry.ts` 与设置页更新动作传递目标版本。
- Tests: Rust backend 单元测试与 Agent Provider registry TypeScript 测试。
- Persistence/security: 不新增持久化字段；目标版本只接受严格语义版本字符串并作为进程参数传递，不经过 shell 拼接。

## Acceptance Criteria

- [x] 当前版本为 `0.1.1-rc.2` 且 dist-tags 为 `latest/next=0.1.1-rc.2`、`alpha=0.1.2-alpha.2` 时，最新版返回 `0.1.2-alpha.2` 且标记可更新。
- [x] 非 DSH Provider 或非预发布版本仍只读取 `latest`。
- [x] 点击 DSH 更新时请求携带检测到的目标版本，后端生成 `@deepseek-ai/dsh@0.1.2-alpha.2` 精确安装计划。
- [x] 非法目标版本与非 DSH 的目标版本参数被拒绝，不能进入生命周期命令。
- [x] Targeted tests、typecheck、Rust format/test、build 与 onboarding gate 完成并记录真实结果。
- [x] Rust 后端改动后重启桌面开发服务，并通过真实版本查询接口确认 Alpha 可见。

## Verification Commands

- `node --import tsx --test src/lib/agent-provider-registry.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml dsh_prerelease -- --nocapture`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- `npm run build`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `npm view @deepseek-ai/dsh dist-tags --json --registry=https://registry.npmjs.org`

## Implementation Record
- 2026-08-31T17:11:28.691Z 已重启 npm run desktop:dev；当前 codem.exe、Agent Mux 与 Vite 均正常运行，真实后端接口已确认 DSH alpha 版本可见。未执行 DSH 安装或更新。

- 2026-08-31T17:11:20.550Z 实现完成：DSH 预发布版本查询改为在 latest、next、alpha 中按语义版本选最高值；更新请求仅为 DSH 携带精确 targetVersion，后端严格校验后生成精确 npm 包版本，其他 Provider 保持原行为。
- 2026-08-31T16:53:35.873Z 已确认根因与修复边界：DSH 预发布查询需同时识别 latest、next、alpha；更新动作必须携带并严格校验已展示的精确目标版本，其他 Provider 行为保持不变。

- 2026-08-31T16:48:20.685Z Task created by Trellis automation.

## Verification Results
- 2026-08-31T17:11:27.879Z `GET /api/agents/latest-version?providerId=deepseek-dsh&currentVersion=0.1.1-rc.2`: pass: latestVersion=0.1.2-alpha.3, updateAvailable=true, error=null

- 2026-08-31T17:11:27.068Z `npm view @deepseek-ai/dsh dist-tags --json --registry=https://registry.npmjs.org`: pass: alpha=0.1.2-alpha.3, latest/next=0.1.1-rc.2
- 2026-08-31T17:11:26.249Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: pass: automated onboarding gate

- 2026-08-31T17:11:25.433Z `npm run build`: pass
- 2026-08-31T17:11:24.621Z `npm run typecheck`: pass

- 2026-08-31T17:11:23.796Z `cargo test --manifest-path src-tauri/Cargo.toml --quiet`: pass: 587 passed, 1 ignored; 16 passed; 21 passed
- 2026-08-31T17:11:23.000Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass

- 2026-08-31T17:11:22.196Z `cargo test --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: pass: 18/18
- 2026-08-31T17:11:21.385Z `node --import tsx --test src/lib/agent-provider-registry.test.ts src/lib/agent-provider-management-ui.test.ts`: pass: 39/39

## Completion Summary
- 2026-08-31T17:11:29.513Z 修复 DSH alpha 通道漏检，并使更新动作严格安装检测到的目标版本；回归、构建、onboarding gate、桌面重启及真实接口验收全部通过。

## Follow-ups

- 如果 DSH 后续新增 beta/canary 等正式发布通道，再基于真实 dist-tags 扩展显式通道策略，不从版本文本猜测通道。
