# Task: 完善供应商创建测试与多选模型添加

## Background

当前供应商创建表单可以填写名称、API 地址、API Key 和协议，但“测试连接”“获取模型”和模型管理只在供应商保存后出现。用户无法在创建前验证配置，也无法从供应商返回的模型列表中多选需要的模型，和 Cherry Studio 一类成熟客户端的配置闭环不一致。

## Objective

创建供应商前即可测试连接、获取模型列表并多选添加，创建和编辑供应商共享完整模型管理体验

## Scope

In scope:

- 创建态支持临时测试连接，不提前保存供应商或 API Key。
- 创建态和编辑态均可请求供应商模型列表，打开可搜索、多选的模型选择器。
- 模型发现与模型写入分离，只有用户确认添加的模型才进入本地配置。
- 创建供应商时同步保存已选择的候选模型和手动添加模型。
- 编辑已有供应商时支持批量添加模型，已存在模型在选择器中明确标识并不可重复添加。
- 保留手动输入模型 ID 和显示名称的能力。
- 补前后端测试、浏览器交互验证和桌面开发服务重启。

Out of scope:

- 不做公共模型市场、模型分类标签和远程推荐榜单。
- 不把测试用 API Key 写入日志、数据库或响应。
- 不自动添加供应商返回的全部模型。

## Impact

- Frontend：供应商创建/编辑操作、模型选择弹窗、草稿模型状态和批量保存。
- Backend：临时供应商探测、只读模型发现和批量模型写入接口。
- Security：测试密钥仅存在于单次请求内存中。

## Acceptance Criteria

- [x] 未创建供应商时可以测试连接，测试不会产生供应商记录或密钥文件。
- [x] 未创建和已创建供应商均可获取模型列表并进行搜索、多选、全选当前结果和确认添加。
- [x] 已存在或已选择模型不会重复添加，并在选择器中显示状态。
- [x] 创建供应商后所选模型全部保存，至少一个模型时自动产生唯一默认模型。
- [x] 手动模型添加在创建态和编辑态均可用。
- [x] 前后端回归测试、生产构建和浏览器真实交互验证通过。

## Verification Commands

- `npm run build`
- `node --import tsx --test` 运行供应商模型选择相关测试。
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `git diff --check`
- 浏览器验证创建态测试连接入口、模型选择器搜索和多选添加。

## Implementation Record
- 2026-07-14T03:36:18.942Z 已补齐创建态闭环：新增临时供应商测试与模型发现接口；模型选择器支持搜索、全选当前结果、多选确认和已添加状态；创建供应商可携带已选模型批量保存，编辑态也可批量添加；忽略开发模式 AbortError 误报。

- 2026-07-14T03:09:06.908Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T03:36:20.583Z `git diff --check && git diff --cached --check`: pass: 工作树与暂存区无空白错误

- 2026-07-14T03:36:20.278Z `浏览器本地模拟供应商交互`: pass: 创建前测试连接发现 3 个模型，获取模型列表、全选和多选确认均通过，刷新后无 AbortError 误报
- 2026-07-14T03:36:19.937Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`: pass: 31 项 ordinary_chat Rust 测试，覆盖创建态发现不持久化和创建模型默认值

- 2026-07-14T03:36:19.571Z `node --import tsx --test src/lib/ordinary-chat-settings.test.ts src/lib/provider-template-search.test.ts src/lib/composer-keyboard.test.ts`: pass: 7 项前端设置、搜索和键盘契约测试
- 2026-07-14T03:36:19.251Z `npm run build`: pass: TypeScript 检查与 Vite 生产构建通过

## Completion Summary
- 2026-07-14T03:37:05.162Z 完善供应商创建态：新增临时测试连接、模型发现、多选模型选择器和批量保存；创建前即可验证并选择模型，编辑态复用同一模型选择器；前后端测试、生产构建和浏览器模拟供应商验证通过。

已完成供应商创建态的测试连接、模型发现和多选添加闭环。临时探测不会持久化供应商或 API Key；模型选择器支持搜索、全选当前结果、已添加状态和批量确认；创建供应商时所选模型随请求保存并保证唯一默认模型，编辑态支持同一选择器批量添加。

## Follow-ups

- 后续有真实需求时再增加模型能力标签和分类筛选。
