# Task: Model Capabilities Settings

## Background

部分第三方模型已经提供更大的上下文窗口，例如 GLM-5.2 支持 1M 上下文，但 CodeM 目前主要依赖内置模型名称判断。长期只靠硬编码会导致新模型上线后需要改代码才能展示能力，模型设置页也无法由用户自行声明上下文能力。

## Objective

在模型设置页增加模型上下文能力配置，支持手动声明 1M 上下文和模型别名。

## Scope

In scope:

- 扩展模型设置数据结构，持久化用户维护的模型能力覆盖规则。
- 在前端和后端设置归一化中校验模型 ID、上下文窗口 token 数、1M 别名和 1M 开关。
- 在模型选项合并时应用用户规则，使默认模型、内置模型和自定义模型都能被手动声明 1M 能力。
- 在“模型设置”页的“新聊天默认选择”和“自定义模型”之间增加“模型能力”区域。
- 增加回归测试覆盖设置归一化和模型能力应用。

Out of scope:

- 不实现从 provider API 自动拉取模型元数据。
- 不改变 Claude Code 供应商配置方式。
- 不改 `/api/claude/run` 的事件协议。
- 不新增复杂规则语言；本次只做精确模型 ID 覆盖。

## Impact

- frontend：`src/types.ts`、`src/lib/settings-api.ts`、`src/hooks/useClaudeRun.ts`、`src/components/settings/ModelSettings.tsx`。
- backend：`server/lib/settings-store.ts`。
- tests：前后端设置归一化测试、模型合并逻辑测试。
- persistence：现有设置 JSON 增加向后兼容字段，旧配置缺失时归一化为空数组。

## Acceptance Criteria

- [ ] 旧模型设置缺失能力字段时仍能正常归一化。
- [ ] 用户可以在模型设置页添加、查看、删除模型能力规则。
- [ ] 能力规则可以声明上下文窗口 token 数、1M 别名和是否展示 1M 选项。
- [ ] 配置规则优先覆盖内置模型能力，不影响未匹配模型。
- [ ] `glm-5.2` 这类新模型可以通过配置生成 `xxx[1m]` 选择项。
- [ ] 定向测试、`npm run typecheck` 和 `git diff --check` 通过。

## Verification Commands

- `npx tsx --test server/lib/settings-store.test.ts tests/useAppSettings.test.ts src/hooks/useClaudeRun.model-options.test.ts server/lib/claude-models.test.ts src/lib/composer-context-usage.test.ts src/lib/claude-model-selection.test.ts src/lib/ui-labels.test.ts src/hooks/useClaudeRun.send-latency.test.ts`
- `npm run typecheck`
- `git diff --check`

## Implementation Record

- 2026-06-22T02:57:42.842Z 实现模型能力配置：新增 modelCapabilities 设置结构和前后端归一化；抽出 claude-model-options 合并 helper；模型设置页新增能力配置表单；Composer 读取当前模型配置的上下文窗口用于用量显示。
- 2026-06-22T02:42:35.390Z 补齐 model-capabilities-settings 任务范围：模型能力覆盖规则、设置页入口、归一化和模型合并测试为本次范围；自动 provider 元数据拉取排除在外。

- 2026-06-22T02:23:30.896Z Task created by Trellis automation.

## Verification Results
- 2026-06-22T02:59:33.799Z `git diff --check`: 通过，exit 0；仅有 Git 在 Windows 下提示 LF 将转换为 CRLF

- 2026-06-22T02:59:24.790Z `npm run typecheck`: 通过，tsc -b exit 0
- 2026-06-22T02:58:12.112Z `npx tsx --test server/lib/settings-store.test.ts tests/useAppSettings.test.ts src/lib/claude-model-options.test.ts server/lib/claude-models.test.ts src/lib/composer-context-usage.test.ts src/lib/claude-model-selection.test.ts src/lib/ui-labels.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: 通过，76/76 tests passed

## Completion Summary
- 2026-06-22T03:00:16.254Z 已完成模型能力配置：设置新增 modelCapabilities，模型设置页可添加/删除精确模型能力规则，模型合并时手动规则覆盖内置能力，Composer 使用配置窗口计算上下文显示；定向测试、typecheck、diff check 均通过。

## Follow-ups

- 后续可评估从公开模型元数据或用户 provider 配置中自动学习上下文窗口。
