# Task: 全局标准下拉统一

## Background

设置页、插件页和 Agent Hub 中同时存在原生 `<select>` 与多套自定义下拉，展开样式、尺寸和主题表现不一致，后续新增页面也容易继续使用系统原生下拉。

## Objective

建立全局 StandardSelect，迁移现有原生简单下拉并写入项目强制规则

## Scope

In scope:

- 提供一个复用现有 PopoverPortal 和主题样式的普通单选组件。
- 迁移 `src/**/*.tsx` 中现有原生单选下拉。
- 在项目规则与前端规范中禁止业务组件新增原生 `<select>`。
- 增加自动检查，防止原生 `<select>` 回流。

Out of scope:

- 搜索、多选、图标、分组或复杂说明等专用下拉的统一重构。
- 与下拉样式无关的 Agent Hub 后端连接和插件数据读取问题。

## Impact

- 普通单选下拉统一使用 `src/components/StandardSelect.tsx`，现有业务取值和保存流程保持不变。
- 插件页保留 34px 紧凑型和 54px 导入型的既有布局尺寸。

## Acceptance Criteria

- [x] `src/**/*.tsx` 不再包含原生 `<select>`。
- [x] 基础设置、外观、Agent Hub、模型、打开方式、MCP、插件与技能使用统一下拉。
- [x] 下拉支持禁用态、空状态、选中勾选、点击外部和 Esc 关闭。
- [x] `AGENTS.md` 与前端组件规范写入强制规则。
- [x] 自动测试阻止业务组件重新引入原生 `<select>`。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/standard-select.test.ts src/lib/basic-settings-layout.test.ts src/lib/agent-mux-ui.test.ts src/lib/workspace-pinning.test.ts`
- `npm run build`
- `rg -n '<select\\b|</select>' src --glob '*.tsx'`
- Playwright 检查基础设置、外观字体、插件导入和 Agent Hub 页面。

## Implementation Record
- 2026-08-05T11:15:11.562Z 新增全局 StandardSelect，迁移基础设置、外观、Agent Hub、模型、打开方式、MCP、插件和技能中的全部普通单选下拉；新增全仓禁止原生 select 的回归测试，并将规则写入 AGENTS.md 与前端组件规范。

- 2026-08-05T11:07:03.701Z Task created by Trellis automation.

## Verification Results
- 2026-08-05T11:27:22.464Z `Playwright visual smoke on 127.0.0.1:5174`: pass: appearance, basic settings and plugin import; Agent Hub data controls unavailable because backend disconnected

- 2026-08-05T11:27:21.767Z `rg native select in src/**/*.tsx`: pass: 0 matches
- 2026-08-05T11:27:21.086Z `npm run build`: pass: existing chunk warnings only

- 2026-08-05T11:27:20.405Z `node --import tsx --test src/lib/standard-select.test.ts src/lib/basic-settings-layout.test.ts src/lib/agent-mux-ui.test.ts src/lib/workspace-pinning.test.ts`: pass: 27/27
- 2026-08-05T11:27:19.727Z `npm run typecheck`: pass

## Completion Summary
- 2026-08-05T11:27:31.803Z 全局 StandardSelect 已建立，现有普通单选下拉全部迁移；项目规则、前端规范和防回退测试已加入，类型检查、27 项测试、生产构建及页面视觉验收通过。

## Follow-ups

- 插件页后端当前未连接，无法在浏览器中展示已安装插件卡片；34px 紧凑型由源码、类型检查和构建覆盖，待后端可用时再做数据态视觉复核。
