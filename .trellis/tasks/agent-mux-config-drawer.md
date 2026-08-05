# Task: Agent Mux 运行配置添加抽屉

## Background

简化版 Agent Mux 原型已有添加配置入口，但尚无具体添加界面。用户确认采用右侧抽屉，并要求配置供应商、模型、可选能力等级、标签和用途。

## Objective

为简化版 Agent Mux 原型增加添加运行配置的可交互抽屉，并在保存后回显配置

## Scope

In scope:

- 顶部、Agent 列表和详情区入口打开统一右侧抽屉。
- Agent 类型只读，供应商、模型、能力等级、用途和标签可编辑。
- 保存后在当前前端会话即时更新配置数量和详情表。
- 抽屉支持遮罩/关闭/取消，并适配 960px 窄窗口。

Out of scope:

- 不接真实配置 API、供应商模型目录或持久化。
- 不实现 Agent 类型注册、认证配置、删除和编辑已有配置。

## Impact

- frontend：更新 AgentMuxPrototype 状态与抽屉样式。
- backend / persistence：无影响。

## Acceptance Criteria

- [x] 三个添加入口打开同一运行配置抽屉。
- [x] 抽屉字段与已确认文字原型一致。
- [x] 保存后新增配置并更新计数，取消不修改数据。
- [x] 960x720 下字段和底部操作完整可用。
- [x] 类型检查、构建和差异检查通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright 验证打开、填写、保存回显、窄窗口与控制台。

## Implementation Record
- 2026-08-04T15:35:42.871Z 抽屉使用固定底部操作栏和 440px 响应式宽度，960px 窗口下保持完整表单。

- 2026-08-04T15:35:42.121Z 保存后仅更新当前前端原型会话中的 Agent profiles，并即时更新 Agent 配置数量和运行配置表；刷新页面后仍恢复 mock 初始数据。
- 2026-08-04T15:35:41.420Z 新增运行配置右侧抽屉，顶部添加入口、列表区加号和详情区添加按钮复用同一交互；Agent 类型只读，供应商、模型、能力等级、用途和标签可编辑。

- 2026-08-04T15:20:28.478Z Task created by Trellis automation.

## Verification Results

- 2026-08-04T15:35:45.833Z `Playwright：Agent Hub -> Agent Mux -> 添加配置 -> 选择 DeepSeek/R1/高级/主执行 -> 保存；配置计数从 4 增至 5，运行配置总数从 7 增至 8；960x720 抽屉；控制台错误数 0`: pass
- 2026-08-04T15:35:45.057Z `git diff --check`: pass

- 2026-08-04T15:35:44.350Z `npm run build`: pass
- 2026-08-04T15:35:43.631Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-04T15:38:18.623Z 完成 Agent Mux 运行配置添加抽屉：字段编辑、取消关闭、保存回显和窄窗口适配均已验证；当前仅保存于前端原型会话。

## Follow-ups

- 后续接真实 Provider/Model 目录时补表单校验、认证状态和持久化。
