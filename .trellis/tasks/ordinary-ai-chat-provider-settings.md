# Task: 普通聊天供应商全局设置与发送体验

## Background

普通 AI 聊天已经具备独立 Provider 管理弹窗和常见供应商模板，但供应商管理尚未成为全局设置的一等页面；无 Provider 时聊天只显示错误文案，缺少明确配置路径；普通聊天 Composer 的 Enter 键发送也存在回归。用户要求参考 mXterm 的空配置引导，并直接查看 CC Switch 源码校准内置供应商快速创建方式。

## Objective

将普通聊天供应商管理接入全局设置，基于 CC Switch 优化预设快速创建，补无供应商引导并修复 Enter 发送

## Scope

In scope:

- 将普通聊天 AI 供应商与模型管理接入全局设置导航和设置内容区。
- 复用或重构现有 `AiProviderManagerDialog` 的业务逻辑，避免全局设置与弹窗形成两套 CRUD。
- 拉取 CC Switch 公开源码，核对 Provider preset 的字段、分组、模板覆盖边界和快速创建流程。
- 保留精选常见官方供应商，不引入中转商市场、推广链接或模板远程覆盖用户配置。
- 无启用供应商或模型时，在普通聊天空态、Composer 和配置入口明确引导到全局设置。
- 修复普通聊天 Enter 发送；Shift+Enter 换行，输入法组合态不得误发。
- 补前端回归测试并验证桌面/Web、明暗主题和窄窗口。

Out of scope:

- 不实现多模型同时回答。
- 不改变 Agent Provider 的原生 CLI 设置语义。
- 不自动迁移或删除现有普通聊天供应商配置。
- 不复制 CC Switch 的合作方、中转商、排名或推广体系。

## Impact

- Frontend：设置导航、普通聊天 Provider 设置页、空态引导、Composer 键盘发送。
- Backend：如 CC Switch 对照发现模板字段缺口，只调整普通聊天模板元数据，不改变密钥存储和协议 adapter。
- UX：配置入口统一到全局设置，聊天内只保留快捷跳转和当前模型选择。

## Acceptance Criteria

- [ ] 全局设置中存在清晰的“AI 供应商”入口，可完整管理普通聊天供应商和多个模型。
- [ ] 常见官方供应商可以从内置模板快速创建，模板不含 API Key、推广链接或第三方中转地址。
- [ ] 无供应商或无启用模型时，普通聊天提供可操作的设置引导，不只显示错误。
- [ ] 聊天内配置入口导航到全局设置对应页面，返回聊天后配置即时刷新。
- [ ] Enter 发送、Shift+Enter 换行、输入法组合态和运行中行为符合 Composer 既有契约。
- [ ] TypeScript、生产构建、相关前端测试和 Rust 普通聊天测试通过。
- [ ] 主工作区桌面开发模式重启并完成真实 UI 验证。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- `node --import tsx --test` 运行设置、Composer、普通聊天相关测试。
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `git diff --check`
- 桌面开发模式验证全局设置、无 Provider 引导和 Enter 发送。

## Implementation Record
- 2026-07-14T02:17:49.225Z 真实 UI 验证确认全局设置出现 AI 供应商、常用厂商分组、普通聊天空态配置引导和从普通聊天进入设置的返回聊天路径；浏览器连接切换期间前端服务重启一次，未修改用户数据。

- 2026-07-14T02:17:48.440Z 已参考本地 D:\\cursor_project\\cc-switch 的类型化 Provider preset 模式，保留 CodeM 精选官方厂商，新增模板分类和 API Key/接口文档入口；创建供应商且填写 API Key 时自动尝试获取模型。
- 2026-07-14T02:17:47.701Z 已将普通聊天供应商管理接入全局设置 AI 供应商页面，复用同一套 CRUD 面板；聊天空态、供应商/模型菜单提供前往全局设置引导；修复普通聊天 Enter 发送并保留 Shift+Enter 换行与输入法组合态。

- 2026-07-14T01:38:57.105Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T02:17:53.101Z `git diff --check`: pass

- 2026-07-14T02:17:52.309Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: pass: 28 tests
- 2026-07-14T02:17:51.524Z `node --import tsx --test src/lib/composer-keyboard.test.ts src/lib/ordinary-chat-settings.test.ts src/lib/composer-input-files.test.ts src/lib/multi-provider-chat-routing.test.ts src/lib/agent-provider-management-ui.test.ts`: pass: 30 tests

- 2026-07-14T02:17:50.793Z `npm run build`: pass
- 2026-07-14T02:17:50.024Z `npm run typecheck`: pass

## Completion Summary
- 2026-07-14T02:19:07.414Z 普通聊天供应商已进入全局设置，完成 CC Switch 风格精选模板分组、无供应商/无模型配置引导、返回聊天路径和 Enter 发送修复；前端与 Rust 门禁、定向回归及真实 UI 验证通过。

## Follow-ups

- 只有真实高频需求出现时再增加新的官方供应商模板。

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
| --- | --- | --- |
| `gh search repos` 使用了不支持的 `nameWithOwner` JSON 字段 | 1 | 改用 CLI 支持的 `fullName` 字段重新查询 |
| GitHub Search API 返回 EOF | 1 | 不重复 Search API，改用已知公开仓库 URL 执行 `git ls-remote` 和浅克隆 |
