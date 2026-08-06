# Task: Agent Mux 渠道与模型级联选择

## Background

Agent Mux 添加运行配置时，系统渠道被误当成仅包含当前默认模型的自定义渠道，导致模型下拉只有一项，且表单先展示供应商/模型、后选渠道，与实际数据依赖顺序相反。

## Objective

添加运行配置时先选择渠道，再加载该渠道支持的全部模型，并由渠道带出供应商。

## Scope

In scope:

- 系统渠道复用 Agent 原生模型目录。
- 自定义渠道仅展示该渠道已启用模型。
- 表单按“渠道 -> 供应商/模型”顺序展示，切换渠道时重置模型和思考等级。

Out of scope:

- 不改动 Agent 渠道设置、密钥管理和模型发现后端。

## Impact

- `src/components/AgentMuxPrototype.tsx` 运行配置表单。
- Agent 渠道模型目录复用与前端回归测试。

## Acceptance Criteria

- [ ] 默认/系统渠道可选择 Agent 原生目录中的多个模型。
- [ ] 先选渠道，后选模型，供应商由渠道带出。
- [ ] 切换渠道后不保留无效模型或思考等级。
- [ ] 编辑现有配置时，若模型仍在当前渠道目录中则保留。

## Verification Commands

- `node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-mux-ui.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-08-06T08:05:21.812Z 实现 Agent Mux 运行配置的渠道优先级联：系统渠道复用 Agent 原生完整模型目录，自定义渠道仅展示已启用模型；供应商由渠道带出，切换渠道时重置失效模型与思考等级。

- 2026-08-06T07:49:12.461Z Task created by Trellis automation.

## Verification Results
- 2026-08-06T08:05:32.278Z `node --import tsx --test src/lib/agent-channel-selection.test.ts src/lib/agent-mux-ui.test.ts; npm run typecheck; npm run build; git diff --check`: 29 个定向测试通过；TypeScript 类型检查通过；Vite 生产构建通过；git diff --check 通过。

## Completion Summary
- 2026-08-06T08:05:42.542Z Agent Mux 添加运行配置现已先选渠道，再选择该渠道可用模型；系统渠道展示完整原生模型目录，供应商自动带出，并保持编辑配置与思考等级切换行为一致。

## Follow-ups
