# Task: Agent 渠道接口类型不受供应商预设限制

## Background

OpenRouter 的 Responses 接口可用，但当前 Agent 渠道界面只展示供应商预设中声明过的协议，导致 OpenAI Codex 选择 OpenRouter 时无法看到 OpenAI Responses。

## Objective

让 Agent 渠道的接口类型按当前 Agent 能力完整展示，不因供应商预设缺少协议而隐藏；保留后端 Agent 协议校验

## Scope

In scope:

- Agent 渠道接口类型按钮按当前 Agent 支持的协议完整展示。
- 供应商预设缺少某个协议时仍可选择，并保留供应商预设与 API 地址。
- 保留后端对 Agent 协议能力的最终校验。

Out of scope:

- 不修改供应商真实接口能力或请求协议转换。
- 不新增 OpenRouter 专属后端适配。

## Impact

- 仅修改 Agent 渠道设置前端逻辑与对应回归测试；后端协议矩阵保持不变。

## Acceptance Criteria

- [x] OpenAI Codex 选择 OpenRouter 时可看到 OpenAI Responses。
- [x] 其他 Agent 仍只展示自身支持的协议集合。
- [x] 选择供应商未声明的协议后，供应商名称、API 地址和预设标识不会被清空。
- [x] `npm run typecheck` 与相关 Node 测试通过。

## Verification Commands

- `node --import tsx --test src/lib/provider-template-search.test.ts`
- `npm run typecheck`

## Implementation Record
- 2026-08-25T06:25:00.000Z 修正供应商预设写回协议的根因：仅当预设协议受当前 Agent 支持时覆盖草稿协议，否则保留当前协议，避免 Codex + OpenRouter 被写回 OpenAI Chat。

- 2026-08-25T06:00:00.530Z 接口类型按钮已改为按当前 Agent 支持协议完整展示；选择供应商未声明协议时仅切换协议并保留模板元数据，后端校验不变

- 2026-08-25T05:57:36.239Z Task created by Trellis automation.

## Verification Results

- 2026-08-25T06:25:00.000Z `node --import tsx --test src/lib/provider-template-search.test.ts`: 11 项测试全部通过
- 2026-08-25T06:25:00.000Z `npm run typecheck`: TypeScript 构建检查通过
- 2026-08-25T06:00:05.695Z `npm run typecheck`: TypeScript 构建检查通过
- 2026-08-25T06:00:05.442Z `node --import tsx --test src/lib/provider-template-search.test.ts`: 10 项测试全部通过

## Completion Summary
- 2026-08-25T06:00:24.728Z 已完成 Agent 渠道协议展示调整：接口类型按钮改为按当前 Agent 能力完整列出，供应商预设缺少协议时仍可选择并保留模板元数据；相关测试与 typecheck 通过。

## Follow-ups

- 如需进一步展示“供应商声明支持/未知”状态，另行增加能力提示，不阻塞协议选择。
