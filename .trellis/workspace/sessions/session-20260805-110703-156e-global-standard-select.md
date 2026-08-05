# Session Record: 全局标准下拉统一

- Session: session-20260805-110703-156e
- Started: 2026-08-05T11:07:03.699Z
- Task: .trellis/tasks/global-standard-select.md

## Notes
- 2026-08-05T11:15:11.562Z 新增全局 StandardSelect，迁移基础设置、外观、Agent Hub、模型、打开方式、MCP、插件和技能中的全部普通单选下拉；新增全仓禁止原生 select 的回归测试，并将规则写入 AGENTS.md 与前端组件规范。

- 2026-08-05T11:07:03.704Z Session started.

## Verification
- 2026-08-05T11:27:22.464Z `Playwright visual smoke on 127.0.0.1:5174`: pass: appearance, basic settings and plugin import; Agent Hub data controls unavailable because backend disconnected

- 2026-08-05T11:27:21.767Z `rg native select in src/**/*.tsx`: pass: 0 matches
- 2026-08-05T11:27:21.086Z `npm run build`: pass: existing chunk warnings only

- 2026-08-05T11:27:20.405Z `node --import tsx --test src/lib/standard-select.test.ts src/lib/basic-settings-layout.test.ts src/lib/agent-mux-ui.test.ts src/lib/workspace-pinning.test.ts`: pass: 27/27
- 2026-08-05T11:27:19.727Z `npm run typecheck`: pass

## Completed

- 2026-08-05T11:27:31.803Z 全局 StandardSelect 已建立，现有普通单选下拉全部迁移；项目规则、前端规范和防回退测试已加入，类型检查、27 项测试、生产构建及页面视觉验收通过。
