# Task: Hermes 思考级别对所有渠道通用

## Background

Hermes 的思考级别属于 Runtime 能力，不应因为自定义渠道没有显式模型列表而从 Composer 消失。DeepSeek 等中转渠道通常只保存端点和凭据，模型由渠道运行时配置决定，因此需要保留 Hermes 的通用模型能力入口。

## Objective

Hermes 的 Brain 思考级别不依赖渠道模型列表，系统渠道和任意自定义渠道均可选择并持久化八档思考级别

## Scope

In scope:

- 让 Hermes 系统渠道和所有启用的自定义渠道共享八档思考级别。
- 自定义渠道模型列表为空时，使用 Hermes 原生目录的 `__default` 模型能力项作为选择锚点，不伪造具体供应商模型 ID。
- 保持非 Hermes 空模型渠道的现有行为。
- 覆盖模型目录、思考级别默认值和 Composer 可见性的回归测试。

Out of scope:

- 修改聊天输入框自适应布局。
- 新增渠道凭据托管、模型探测协议或供应商特例。

## Impact

- `src/lib/agent-channel-selection.ts` 生成 Hermes 自定义渠道目录。
- `src/lib/agent-channel-selection.test.ts` 验证空模型渠道及非 Hermes 回归。
- Composer 继续消费统一模型目录，不新增 DeepSeek 分支。

## Acceptance Criteria

- [ ] Hermes 有显式模型的渠道仍继承八档 reasoning effort，默认 `medium`。
- [ ] Hermes `models: []` 且 native catalog 含 `__default` 时返回该默认项并包含八档能力。
- [ ] Hermes `models: []` 且没有 native default 时仍返回可选的 `__default` 能力项。
- [ ] 非 Hermes `models: []` 仍返回空模型目录。
- [ ] `npm run typecheck`、定向 Node 测试、onboarding gate 和 `git diff --check` 通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts`
- `npm run typecheck`
- `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`
- `git diff --check`

## Implementation Record

- 2026-08-10T13:26:34.692Z 将 Hermes 思考能力归属到 Runtime：自定义渠道无显式模型时使用原生 __default 选择项；补充 DeepSeek 空模型渠道和非 Hermes 回归测试。
- 2026-08-10T13:26:10.436Z 将 Hermes 思考能力归属到 Runtime：自定义渠道无显式模型时使用原生 __default 选择项；补充 DeepSeek 空模型渠道和非 Hermes 回归测试。

- 2026-08-10T13:12:21.617Z Task created by Trellis automation.
- Hermes reasoning is a provider-runtime capability. Empty custom channel model lists use the native `__default` catalog entry as the UI selection anchor.

## Verification Results

- 2026-08-10T13:34:39.350Z `git diff --check`: 通过，无空白错误。
- 2026-08-10T13:34:38.677Z `python C:/Users/syscr/.codex/skills/codem-agent-onboarding/scripts/check_onboarding.py D:/ai_proj/codem`: Agent onboarding gate passed：72 项合同测试、typecheck、Rust fmt/相关测试和 production build 全部通过。

- 2026-08-10T13:34:38.019Z `npm run typecheck`: TypeScript project build passed。
- 2026-08-10T13:34:37.390Z `node --import tsx --test src/lib/agent-channel-selection.test.ts`: 22 项通过，覆盖 Hermes 显式模型、空模型、native catalog 不可用以及非 Hermes 回归。

## Completion Summary
- 2026-08-10T13:34:56.788Z Hermes 思考级别已改为 Runtime 通用能力：DeepSeek 等无显式模型渠道使用 __default 选择项并显示八档 Brain 控件，非 Hermes 行为不变；定向测试与 onboarding 全门禁通过。

## Follow-ups

- 待补充。
