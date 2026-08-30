# Task: 修复 Grok 思考强度控制

## Background

CodeM 的 Grok 模型目录只保留模型名称和上下文窗口，丢弃了 Grok ACP 在模型 `_meta` 中公开的 `reasoningEfforts`；Composer 又使用 Provider 白名单显示思考强度，后端同时拒绝 Grok ACP 携带 `reasoningEffort`。本机 Grok CLI 1.0.5 的普通和 `agent stdio` 模式均已支持 `--reasoning-effort`。

## Objective

从 Grok 运行时能力读取模型思考档位，在 Composer 展示并将选择值传入 Grok ACP stdio runtime

## Scope

In scope:

- 将 Grok ACP 模型 `_meta.reasoningEfforts`、`reasoningEffort` 映射为 CodeM 模型能力。
- Composer 根据当前模型是否公开思考档位显示统一 Brain 控件，不再维护 Provider 白名单。
- 将用户选择的 Grok reasoning effort 作为 CLI 参数传入 `grok agent stdio`。
- 保持模型、思考强度、权限和渠道继续参与热 Runtime 复用判断。
- 增加 ACP 元数据解析、Grok 启动参数和前端能力显示回归测试。

Out of scope:

- 不修改 Grok 登录、全局配置、渠道凭据或 Provider session 数据。
- 不硬编码 Grok 支持的思考档位，不为未公开该能力的模型显示控件。
- 不新增 Provider 专属前端控件，不改变公开 streaming event 与持久化协议。
- 不实现运行中的实时 effort 切换；Composer 运行中仍锁定选择，下一次运行按新配置启动或复用。

## Impact

- Driver: `src-tauri/src/acp.rs` 解析 Grok 模型公开能力。
- Runtime/API: `src-tauri/src/agent_run.rs` 输出模型能力并传递 CLI 启动参数。
- Frontend: `src/components/Composer.tsx` 按能力显示现有思考强度控件。
- Security/privacy: 只保留档位 ID、说明和默认值，继续丢弃模型 `_meta` 中其他字段。

## Acceptance Criteria

- [ ] Grok 模型公开档位时，Composer 显示思考强度并使用模型默认值。
- [ ] Grok 模型未公开档位时不显示控件，不生成静态兜底档位。
- [ ] 选择值通过 `--reasoning-effort <id>` 传入 Grok `agent stdio`。
- [ ] 非 Grok ACP Provider 的 reasoning effort 限制不被放宽。
- [ ] 模型、强度或权限变化不会错误复用旧热 Runtime。
- [ ] 自动化门禁和本机 Grok 真实模型目录/UI 验收通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/grok-reasoning-effort.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm run typecheck`
- `npm run build`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- 桌面开发模式实际检查 Grok 4.6 模型档位、选择和真实运行参数。

## Implementation Record
- 2026-08-28T12:30:34.410Z 确认最后一次提交 fa998f0 在 PATCH 成功后立刻清 pending，本地 modelPreferences 仍是旧档位，同步 effect 会把 UI 弹回。现改为当前 reasoningEffort 覆盖同模型旧偏好，本地摘要同步更新 modelPreferences，pending 等到摘要匹配后再清除。

- 2026-08-28T12:17:00.693Z 修复思考级别切换弹回：PATCH 后本地 modelPreferences 未同步，保存成功后又被旧档位覆盖。现改为当前 reasoningEffort 覆盖同模型旧偏好，本地摘要同步更新 modelPreferences，pending 选择等到摘要匹配后再清除。
- 2026-08-28T09:21:31.993Z 修复 Grok 思考级别切换的异步竞态：同一会话元数据 PATCH 串行化，并在保存确认前保持最新乐观选择。

- 2026-08-28T08:38:16.894Z 补齐 backend.rs 的 provider_supports_reasoning_effort：Grok Build 运行链已支持 reasoning_effort，但创建/更新会话元数据仍遗漏 grok-build，导致切换时 PATCH /api/threads/:id 返回 400。现已加入 GROK_BUILD_PROVIDER_ID，并将错误文案改为按当前 Agent 能力描述。
- 2026-08-28T08:15:30.087Z 确认 Provider=grok-build、Driver=ACP、思考强度能力=runtime-detected。只解析 Grok 模型 _meta.reasoningEfforts/reasoningEffort；Composer 按模型能力显示；运行时通过 grok agent --reasoning-effort <id> stdio 传递。现有 runtime config 已比较 reasoning_effort，切换后不会错误复用旧进程。

- 2026-08-28T08:13:00.786Z Task created by Trellis automation.

## Verification Results
- 2026-08-28T12:31:18.009Z `node --import tsx --test src/lib/thread-model-preferences.test.ts src/lib/grok-reasoning-effort.test.ts; npm run typecheck`: pass: 10 related tests + typecheck. 浏览器 5173 可开但 3001 拒绝连接，页面停在设置且无项目，未能在 UI 里点 High/Low 做端到端验收。

- 2026-08-28T12:17:00.814Z `node --import tsx --test src/lib/thread-model-preferences.test.ts src/lib/grok-reasoning-effort.test.ts; npm run typecheck`: pass: 8 related tests + typecheck
- 2026-08-28T09:21:32.650Z `npm run typecheck`: pass

- 2026-08-28T09:21:32.318Z `node --import tsx --test src/**/*.test.ts`: pass: 890 tests
- 2026-08-28T08:38:17.273Z `cargo test thread_provider_defaults_to_claude_and_requires_installed_agents；Grok/路由 TS 10 项；onboarding gate 74 项；typecheck；cargo fmt --check；git diff --check；Playwright High→Low→High`: 全部通过。浏览器按钮按顺序显示 High、Low、High；修复后无操作失败提示、无 PATCH 400；CodeM 桌面开发进程已重启。

## Completion Summary

- 2026-08-28T12:31:29.662Z 修复 Grok 思考级别切换一次会弹回：当前 reasoningEffort 覆盖同模型旧偏好，本地摘要同步更新 modelPreferences，pending 等到摘要匹配后再清除。相关测试 10 项与 typecheck 通过。
- 2026-08-28T12:17:19.486Z 修复 Grok 思考级别切换一次会弹回的问题：当前 reasoningEffort 覆盖同模型旧偏好，本地线程摘要同步更新 modelPreferences，pending 选择等到摘要匹配后再清除。

- 2026-08-28T09:21:32.967Z Grok 思考级别切换已修复并完成前端回归、类型检查和延迟请求浏览器验证。
- 2026-08-28T08:38:17.667Z Grok 4.6 思考强度恢复并修复切换保存 400；模型能力、Composer、ACP 参数、会话元数据、自动化门禁及浏览器/桌面验收全部完成。

## Follow-ups

- 已修复：PATCH 后本地 `modelPreferences` 与 pending 清理对齐；换渠道不再清空各模型思考档位。
