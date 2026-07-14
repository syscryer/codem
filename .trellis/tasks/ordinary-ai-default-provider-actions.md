# Task: 普通聊天默认供应商与保存入口

## Background

普通聊天供应商设置取消内层滚动后，外层面板左上和左下的圆角背景未完整收口；保存按钮位于表单底部，长配置下不够醒目；供应商本身也缺少类似模型的默认选择机制，新聊天只能依赖列表顺序选择第一个可用供应商。模型发现入口目前只有刷新图标，语义不够清楚。

## Objective

补齐普通聊天默认供应商持久化和选择逻辑，修复设置面板圆角并强化保存入口

## Scope

In scope:

- 修复普通聊天供应商设置外层左上、左下圆角及侧栏背景裁切。
- `ai_providers` 增加 `is_default` 持久化字段和单默认约束，接口返回 `isDefault`。
- 首个启用供应商自动成为默认；设置其他供应商为默认时原默认自动取消。
- 删除或禁用默认供应商后，自动选择下一个启用供应商；没有启用供应商时允许暂时无默认。
- 已保存和新建供应商都可以在配置头部选择“设为默认”，保存时与其他配置一起持久化。
- 新建普通聊天草稿优先选择默认供应商及其默认模型，已有聊天选择不变。
- “保存配置 / 创建供应商”移动到配置卡右上角并保持主按钮样式；底部只保留测试连接。
- 模型区右上角的图标按钮改为“获取模型”文字按钮。

Out of scope:

- 不改变单个模型的默认模型机制。
- 不影响 Agent 与模型页面的 Provider 配置和默认 Agent Provider。
- 不迁移已有聊天的 providerId 或 modelId。

## Impact

- Backend：普通聊天供应商表迁移、默认唯一性修复、创建/更新/删除逻辑和响应契约。
- Frontend：普通聊天供应商类型、默认选择、设置表单操作区、列表状态和模型发现按钮。
- Compatibility：旧数据库初始化时自动补列并从现有启用供应商中选出默认项。
- Security：API Key vault 与日志策略不变。

## Acceptance Criteria

- [x] 设置面板左上、左下圆角完整，取消内层滚动后仍无背景溢出。
- [x] 普通聊天供应商最多只有一个默认项，首个启用供应商自动默认。
- [x] 已保存或新建供应商可设为默认，保存后列表和配置头部状态同步。
- [x] 删除或禁用默认供应商后自动顺延到下一个启用供应商。
- [x] 新建普通聊天优先选择默认供应商和其默认模型，已有聊天不受影响。
- [x] 保存/创建按钮固定在配置卡右上角，底部测试连接仍可用且不重复显示保存按钮。
- [x] 模型区右上角显示“获取模型”文字按钮，模型发现和多选流程保持可用。
- [x] 旧数据库迁移、默认供应商存储测试、前端类型检查和浏览器验收通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::storage::tests`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- Playwright 验证圆角、默认供应商、右上保存按钮、“获取模型”和新聊天默认选择。

## Implementation Record

- 2026-07-14T15:03:45.095Z 设置页将设为默认、启用和保存配置集中到配置卡右上；模型入口改为带刷新图标的获取模型文字按钮；补齐左侧圆角及 1024 宽度响应式布局。
- 2026-07-14T15:03:44.737Z 实现普通聊天默认供应商字段、旧库迁移、单默认约束、创建更新删除后的自动顺延，以及新建聊天默认供应商和模型选择。

- 2026-07-14T14:38:52.747Z Task created by Trellis automation.

## Verification Results

- 2026-07-14T15:03:46.616Z `Playwright 1024x768 与 1440x900 浏览器验收`: 通过：获取模型文字、默认供应商标记、右上保存、左侧圆角、窄屏响应式及新聊天默认 MiniMax Token Plan/MiniMax-M3 均符合预期，控制台 0 错误。
- 2026-07-14T15:03:46.223Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check；敏感信息扫描`: 通过：格式和 diff 检查无错误，未发现 sk- 形式敏感值。

- 2026-07-14T15:03:45.872Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat`: 通过：42 项普通聊天 Rust 测试全部通过。
- 2026-07-14T15:03:45.434Z `npm run typecheck；node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts`: 通过：TypeScript 无错误，17 项前端测试全部通过。

## Completion Summary
- 2026-07-14T15:05:10.604Z 完成普通聊天供应商默认项、旧库迁移与自动顺延；将设为默认、启用、保存入口集中到配置头部；模型按钮改为获取模型文字按钮；修复左侧圆角和窄屏布局。TypeScript、17 项前端测试、42 项普通聊天 Rust 测试、格式检查、敏感信息扫描及 1024/1440 浏览器验收全部通过。

## Follow-ups

- 无。
