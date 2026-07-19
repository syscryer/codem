# Task: 外部渠道导入与同步

## Background

CodeM 已分别提供 Agent 渠道与普通聊天供应商管理，但用户在 CCSwitch 或 Cherry Studio 中已有可复用配置。需要增加只读外部导入，减少重复录入，同时保持 CodeM 当前运行、默认选择、会话引用和加密存储机制不变。

## Objective

为 Agent 和普通聊天增加来源隔离的外部渠道导入：Agent 读取 CCSwitch 的 Claude/OpenAI/OpenCode 配置，普通聊天读取 Cherry Studio 配置；支持批量选择、已导入灰态、密钥安全写入、同名覆盖确认和用户主动同步，不改变现有运行机制。

## Scope

In scope:

- Agent 渠道从 CCSwitch 只读扫描 Claude、OpenAI Codex、OpenCode 配置。
- 普通聊天供应商从 Cherry Studio 只读扫描配置。
- 通过外部稳定 ID 记录导入关系；已导入项灰显，有更新时允许用户主动同步。
- 支持搜索、未导入筛选、多选批量导入和单项异步状态。
- CCSwitch 和 Cherry Studio 扫描结果只展示已配置可迁移 API Key 的渠道，无密钥项不进入前端列表和发现数量。
- 同名目标要求用户确认覆盖；覆盖保留 CodeM 目标 ID、默认/启用状态和历史引用。
- 外部没有模型时允许导入，不推测模型；同步时旧模型停用而不直接删除。
- API Key 只在后端读取并直接写入 CodeM 加密 vault，不返回前端、不进入日志。
- Agent 渠道支持复制为独立的普通聊天供应商，包含协议、地址、密钥、模型和图标信息。
- 渠道管理中增加与 Agent 同级的“普通聊天”入口；设置主菜单不再重复展示“普通聊天”，但保留旧 section 兼容应用内已有跳转。

Out of scope:

- Grok Build 自动外部导入。
- 后台自动同步、监听外部配置变化或回写 CCSwitch/Cherry Studio。
- 合并 Agent 与普通聊天的数据库、运行时或会话机制。
- 根据外部渠道名称猜测模型、协议或缺失配置。
- 删除现有普通聊天供应商管理入口。

## Impact

- Backend: 新增外部配置解析、导入关系持久化、安全导入/同步/复制 API。
- Frontend: 新增共享导入弹窗、Agent/普通聊天入口及导入状态刷新。
- Persistence: 新增独立导入关系表；现有 `agent_channels`、`ai_providers` 和会话表保持兼容。
- Security: 明文密钥不得越过后端边界，错误与日志不得包含密钥。

## Acceptance Criteria

- [x] Agent 页面可扫描 CCSwitch 中 Claude/OpenAI Codex/OpenCode 渠道，普通聊天页面可扫描 Cherry Studio 供应商。
- [x] 已导入来源项不可重复选择；来源更新后显示“有更新”，仅在用户点击同步时覆盖 CodeM 配置。
- [x] 导入和同步 API 不返回 API Key 明文；密钥直接写入现有加密 vault。
- [x] 同名目标在用户确认前不覆盖；确认覆盖后保留目标 ID、默认/启用状态及历史引用。
- [x] 无模型来源可正常导入；同步后已不存在的旧模型仅停用。
- [x] Agent 渠道可复制到普通聊天，同名时使用同样的覆盖确认，复制后两边配置独立。
- [x] 新入口、弹窗和状态反馈使用现有主题 token，并支持深浅色、键盘操作和窄窗口。
- [x] Agent 和普通聊天导入按钮复用 CodeM `settings-action-button` token 风格，不出现浏览器默认黑色粗边框。
- [x] Agent/普通聊天导入弹窗的刷新按钮同样使用主题 token，扫描结果不展示未配置可迁移 API Key 的渠道。
- [x] 渠道管理中的普通聊天复用 Agent 双栏外框，Cherry Studio 导入入口与刷新按钮统一放在顶部操作区。
- [x] 现有 Agent/普通聊天的创建、编辑、删除、默认选择和运行机制不发生回归。

## Verification Commands

- `npm run build`
- `node --test src/lib/provider-import-ui.test.ts src/lib/ordinary-chat-settings.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml provider_import`
- `cargo test --manifest-path src-tauri/Cargo.toml names_are`
- `git diff --check`

## Implementation Record

- 2026-07-19T03:15:26.937Z 修正普通聊天实际嵌入入口：AiProviderSettingsPanel 新增 channelLayout 变体，隐藏内部工具栏并复用 Agent 渠道完整双栏外框；Cherry Studio 导入按钮上移到渠道页顶部操作区，父层根据当前页签打开正确导入目标。
- 2026-07-19T03:03:41.683Z 修复普通聊天渠道页左侧供应商列表边框：设置页不再沿用弹窗的单侧分隔线，改为使用 app-border token 的完整四边框和 9px 圆角；补充样式回归断言。

- 2026-07-19T02:37:47.242Z 按用户反馈移除设置侧边栏的普通聊天重复入口；保留 aiProviders 内部 section 兼容旧跳转。Agent 与普通聊天导入按钮统一改用 settings-action-button 主题 token 类，消除浏览器默认黑色粗边框。
- 2026-07-18T18:59:21.864Z 前端新增共享导入弹窗、搜索/未导入筛选、多选批量导入、单项同步；渠道管理加入普通聊天同级页签，并支持 Agent 渠道复制到普通聊天。

- 2026-07-18T18:59:20.856Z 导入关系使用 external_provider_imports 独立记录；已导入灰显，来源指纹变化后由用户主动同步；同名覆盖保留目标 ID、启用/默认状态和历史引用，外部无模型时不修改用户手工模型。
- 2026-07-18T18:59:20.052Z 实现独立 provider_import 后端模块：CCSwitch 只读扫描 Claude/Codex/OpenCode，Cherry Studio 兼容 SQLite 2.x 与 LevelDB 1.x；API Key 仅在后端写入加密 vault，扫描响应只返回 apiKeyAvailable。

- 2026-07-18T17:54:55.704Z Task created by Trellis automation.

## Verification Results

- 2026-07-19T03:15:27.726Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-import-ui.test.ts；npm run typecheck；Playwright 真实页面宽屏与 760px 窄屏验证`: 通过：19/19 定向测试、TypeScript 类型检查；真实页面确认完整双栏边框、顶部 Cherry Studio 导入按钮、普通聊天导入弹窗以及窄屏上下布局均正常。
- 2026-07-19T03:03:42.544Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts；npm run typecheck；git diff --check -- src/styles.css src/lib/ordinary-chat-settings.test.ts`: 通过：普通聊天设置测试 14/14、TypeScript 类型检查、相关文件空白检查。

- 2026-07-19T02:37:48.129Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-import-ui.test.ts；npm run typecheck；git diff --check（相关文件）`: 通过：18/18 设置与导入回归测试，TypeScript 类型检查和相关差异空白检查均通过。
- 2026-07-18T18:59:33.999Z `git diff --check 与敏感 token 扫描`: 通过；无空白错误、无 sk-/Bearer 密钥进入补丁。

- 2026-07-18T18:59:32.462Z `Playwright Web UI 回归`: 通过；五个同级渠道页签、Agent/普通聊天导入弹窗、搜索筛选、滚动与点击区域正常。
- 2026-07-18T18:59:30.543Z `真实本机只读扫描与临时库烟测`: 通过；识别 CCSwitch 39 项（Claude 18/Codex 15/OpenCode 6）和 Cherry Studio 63 项；Agent 导入、复制到普通聊天、Cherry 导入、密钥保存和已导入标记均成功。

- 2026-07-18T18:59:28.961Z `cargo test --manifest-path src-tauri/Cargo.toml names_are`: 通过，2/2；Agent 分域重名和普通聊天全局重名校验。
- 2026-07-18T18:59:27.117Z `cargo test --manifest-path src-tauri/Cargo.toml provider_import`: 通过，4/4；覆盖解析、密钥不出响应、覆盖保留状态、空模型非破坏性同步。

- 2026-07-18T18:59:25.544Z `node --test src/lib/provider-import-ui.test.ts src/lib/ordinary-chat-settings.test.ts`: 通过，17/17。
- 2026-07-18T18:59:24.337Z `npm run build`: 通过；Vite 生产构建完成，仅有既有动态导入与大 chunk 警告。

## Completion Summary

- 2026-07-19T03:15:43.294Z 普通聊天渠道页已与 Agent 渠道页统一为完整响应式双栏布局，修复实际入口左栏边框断开；Cherry Studio 导入入口上移至顶部操作区并保持普通聊天导入语义。
- 2026-07-19T03:04:11.148Z 完成外部渠道导入收口与普通聊天渠道页视觉修正：无密钥来源在后端过滤，导入按钮和弹窗操作统一主题 token，批量成功导入自动关闭窗口；左侧供应商列表恢复完整主题边框与圆角。

- 2026-07-19T02:37:49.187Z 移除设置主菜单普通聊天重复入口，并将 Agent/Cherry Studio 导入按钮统一为 CodeM 主题 token 风格；旧内部配置 section 保持兼容。
- 2026-07-18T18:59:36.109Z 完成外部渠道导入与同步完整版：Agent 从 CCSwitch 导入三类渠道，普通聊天从 Cherry Studio 导入，支持去重、同名确认覆盖、主动同步、密钥安全迁移、Agent 复制到普通聊天及普通聊天同级入口；现有运行和会话机制保持独立。

## Follow-ups

- 暂无；Grok Build 外部导入和后台自动同步仍按范围约定保持不实现。
