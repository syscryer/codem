# Task: 完善普通聊天供应商与模型交互

## Background

普通聊天供应商设置中的模型选择弹窗因网格列定义错误，模型名称和 ID 被压缩成省略号；“获取模型列表”按钮没有复用统一控件样式。已保存的 API Key 只能覆盖，不能由用户主动查看。聊天输入区的供应商和模型入口还需要收拢为相邻的一组独立控件，供应商入口使用通用 Agent 图标，和普通聊天的厂商品牌不一致。

## Objective

修正模型列表和按钮样式，支持安全查看 API Key，并将聊天输入区的供应商与模型选择收拢为相邻的独立入口

## Scope

In scope:

- 修正模型选择弹窗的文本布局、行高、选择态和小屏适配，完整展示常规模型名称与 ID。
- 将“获取模型列表”调整为统一的刷新图标按钮，并保留无障碍名称和加载态。
- 为已保存供应商增加按需读取 API Key 的接口和显隐按钮；响应禁止缓存，切换供应商或隐藏时清理读取出的明文。
- 普通聊天 Composer 将供应商和模型选择放在同一控件组内，但保持两个独立入口：供应商只展示厂商图标，模型展示当前模型名称。
- 切换供应商时自动选择该供应商的首选模型，模型入口只展示和切换当前供应商的可用模型。
- 保持 Agent Composer、普通聊天会话数据结构和模型多选保存协议不变。

Out of scope:

- 不在 bootstrap、数据库、聊天历史、trace 或日志中返回 API Key 明文。
- 不修改 Agent 与模型设置页的 Provider/模型选择逻辑。
- 不引入新的供应商、模型协议或凭据同步能力。

## Impact

- Frontend：供应商设置、模型选择弹窗、普通聊天 Composer、供应商图标映射和普通聊天状态动作。
- Backend：普通聊天供应商 API Key 的本地 vault 按需读取接口。
- Security：只有用户主动点击查看时返回明文，响应使用 `Cache-Control: no-store`。

## Acceptance Criteria

- [x] 模型选择弹窗在桌面和窄视口下完整展示模型名称与 ID，不再只显示首字母和省略号。
- [x] “获取模型列表”使用统一图标按钮样式，加载、禁用、悬浮和提示状态正确。
- [x] 已保存 API Key 可主动查看和隐藏；切换供应商后不保留明文，接口响应不可缓存。
- [x] 普通聊天供应商与模型入口相邻成组但保持独立，供应商入口只展示真实厂商图标。
- [x] 供应商菜单可以切换厂商，模型菜单只展示当前厂商的可用模型，当前选择和不可用状态清晰。
- [x] Agent Composer 行为不变，Rust 测试、前端测试、构建和 Playwright 验收通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/composer-keyboard.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check && git diff --cached --check`
- Playwright 验证设置页 API Key 显隐、模型弹窗、图标按钮和普通聊天相邻的供应商/模型选择器。

## Implementation Record
- 2026-07-14T07:41:57.640Z 修正普通聊天供应商与模型交互：底部改为相邻但独立的厂商图标选择器和当前厂商模型选择器；同时完成模型列表布局、刷新按钮、API Key 显隐和安全读取。

- 2026-07-14T06:22:54.876Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T07:42:15.569Z `ordinary-ai-provider-model-ui-polish`: 通过：Rust ordinary_chat 37 项、前端 8 项、npm run build、git diff --check、git diff --cached --check、敏感信息扫描；Playwright 验证 1280x800 下设置页、8 模型弹窗、API Key 显隐及普通聊天相邻独立的厂商/模型选择器。

## Completion Summary
- 2026-07-14T07:42:32.458Z 完成普通聊天供应商与模型 UI 完善：模型列表完整展示，获取按钮统一为刷新图标，已保存 API Key 可按需查看/隐藏；Composer 中厂商图标与模型作为相邻独立入口，厂商和模型可分别切换，Agent 模式保持不变。

## Follow-ups

- 无。
