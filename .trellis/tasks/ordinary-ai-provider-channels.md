# Task: 统一厂商渠道与接口配置

## Background

普通聊天的常用厂商目前按单个接口模板平铺，导致 MiniMax、Kimi、百炼等品牌因标准 API、Coding Plan 或地区入口重复出现，也无法在同一厂商内明确切换协议。用户需要先选厂商，再按真实支持情况选择渠道和接口类型，由系统自动填充 API 地址。

支持矩阵以 Cherry Studio provider registry、CC Switch 官方厂商预设和厂商公开接口为依据。模板只表达已确认可用的组合，不为厂商虚构协议。

## Objective

基于 CC Switch、Cherry Studio 和官方能力整理供应商支持矩阵，合并重复厂商入口并实现渠道与接口类型驱动的 URL 自动配置

## Scope

In scope:

- 常用厂商列表按品牌合并，每个厂商只显示一次并保留搜索。
- 模板增加厂商、渠道、接口类型维度；后端仍以扁平接口配置返回，前端按厂商分组。
- 创建模板配置时先选择渠道，再选择该渠道真实支持的接口类型，自动填充 API 地址、密钥入口和文档地址。
- 已保存供应商实例继续独立展示和管理，不因厂商合并而合并密钥、模型或启用状态。
- 保留既有 `presetId` 持久化方式，兼容已保存的标准 API 和 Token Plan/Coding Plan 配置。
- 自定义供应商继续允许用户自行选择接口类型和填写地址。
- 首批支持矩阵：
  - OpenAI：标准 API / OpenAI Responses。
  - Anthropic：标准 API / Anthropic。
  - Google Gemini：标准 API / Gemini。
  - DeepSeek：标准 API / OpenAI Chat、Anthropic。
  - MiniMax：国内标准 API、国际标准 API / OpenAI Chat、Anthropic；国内 Token Plan、国际 Token Plan / Anthropic。
  - Kimi：标准 API / OpenAI Chat、Anthropic；Kimi For Coding / Anthropic。
  - 智谱 GLM：中国区标准 API / OpenAI Chat、Anthropic；国际区标准 API / OpenAI Chat、Anthropic；Coding Plan / OpenAI Chat。
  - 阿里云百炼：标准 API / OpenAI Chat、OpenAI Responses、Anthropic；Coding Plan / Anthropic。
  - OpenRouter：标准 API / OpenAI Chat、Anthropic。

Out of scope:

- 不内置 CC Switch 中未经筛选的第三方中转站、推广渠道或 OAuth 专用渠道。
- 不改变普通聊天与 Agent 的独立运行、配置和持久化机制。
- 不迁移或合并用户已有的供应商实例。
- 不在本任务新增模型并行回答、知识库或附件能力。

## Impact

- Backend：`ProviderTemplate` 返回契约及内置模板数据。
- Frontend：普通聊天 AI 设置中的模板分组、搜索、渠道与接口类型选择。
- Compatibility：旧 `presetId` 必须仍能定位到同一接口配置。
- Security：API Key 处理方式不变，不进入模板、日志或任务文档。

## Interaction And Visual Direction

- 视觉主张：延续 CodeM 安静、紧凑的设置面板风格，用清晰的层级和选中态表达配置关系。
- 内容结构：左侧是已保存供应商和按品牌合并的常用厂商；右侧是实例信息、渠道、接口类型、自动填充地址、密钥和模型。
- 交互主张：切换厂商时进入该厂商默认接口；切换渠道时优先保留仍受支持的接口类型，否则选择该渠道默认接口；切换接口类型立即更新 URL 和关联链接。

## Acceptance Criteria

- [x] 常用厂商列表中 MiniMax、Kimi、智谱、百炼等品牌各只出现一次。
- [x] 搜索可命中厂商名称、渠道名称、接口类型及 API 域名。
- [x] 选择厂商后可以分别选择渠道和接口类型，且只显示支持矩阵中的真实组合。
- [x] 切换渠道或接口类型后，API 地址、`presetId`、密钥入口和文档入口同步更新。
- [x] 已保存供应商实例可正常编辑；旧模板 `presetId` 能反向定位厂商、渠道和接口类型。
- [x] 自定义供应商不受模板矩阵限制，仍可手工配置四种接口类型。
- [x] 新建、测试连接、获取模型列表、多选模型和保存流程保持可用。
- [x] 前端类型检查、模板搜索测试、后端 provider 测试和浏览器交互验收通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/provider-template-search.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- 浏览器验证普通聊天 AI 设置中的厂商搜索、渠道切换、接口类型切换、URL 自动填充和旧配置编辑。

## Implementation Record

- 2026-07-14T11:28:15.110Z 完成 9 个常用厂商、25 个接口配置的厂商分组；实现渠道与接口类型独立选择、URL 与关联链接自动切换，并补齐分组搜索和界面契约回归测试
- 2026-07-14：后端模板扩展为 25 个真实接口配置，前端按 9 个厂商品牌分组；模板增加厂商和渠道元数据，保留全部旧 `presetId`。
- 2026-07-14：设置界面增加渠道与接口类型两个独立选择区；切换后同步更新地址、协议、密钥入口和文档入口，自定义供应商仍保留四种协议自由配置。
- 2026-07-14：修复从已保存供应商切换到常用厂商时创建草稿被清空导致右侧空白的问题，并补充厂商分组、搜索和界面契约测试。
- 2026-07-14T11:12:51.553Z 完成厂商支持矩阵调研并固化领域模型：常用厂商按品牌分组，渠道与接口类型使用真实组合；旧 presetId 保持兼容。

- 2026-07-14T11:00:17.656Z Task created by Trellis automation.
- 2026-07-14：确认使用“厂商 → 渠道 → 接口类型 → 接口配置”领域模型；已保存供应商实例保持独立。
- 2026-07-14：基于 Cherry Studio provider registry 与 CC Switch 官方厂商预设整理首批支持矩阵，排除未经确认的组合和第三方推广中转站。

## Verification Results

- 2026-07-14T11:28:16.022Z `npm run typecheck；前端供应商测试；Rust provider 测试；cargo fmt --check；git diff --check；Playwright 浏览器验收`: 全部通过：前端 12 项、Rust 13 项；DeepSeek、MiniMax、百炼渠道和接口类型切换正常，1024x768 布局正常，控制台 0 错误 0 警告
- `npm run typecheck`：通过。
- `node --import tsx --test src/lib/provider-template-search.test.ts src/lib/ordinary-chat-settings.test.ts`：12 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`：13 项通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
- `git diff --check`：通过，仅有工作区既有的 LF/CRLF 提示。
- 敏感信息模式扫描：未发现密钥或令牌进入变更。
- 浏览器验收：DeepSeek 可切换 OpenAI Chat / Anthropic；MiniMax 可切换国内、国际标准 API 和 Token Plan；百炼可切换标准 API / Coding Plan 及各自真实支持的接口类型；搜索和 1024×768 布局正常，控制台无错误或警告。

## Completion Summary

- 2026-07-14T11:28:16.900Z 普通聊天供应商配置已统一为厂商、渠道、接口类型三级选择；内置常用厂商真实支持矩阵，保留旧 presetId 和自定义供应商能力，自动化与浏览器验收全部通过
- 普通聊天设置已统一为“厂商 -> 渠道 -> 接口类型 -> 接口配置”，厂商品牌不再因地区、协议或套餐重复展示。
- 首批内置 9 个常用厂商、25 个已确认接口配置；普通聊天与 Agent 配置、运行和持久化仍保持独立。

## Follow-ups

- 后续新增厂商时需要先核对公开文档或可信开源实现，再扩展支持矩阵。
