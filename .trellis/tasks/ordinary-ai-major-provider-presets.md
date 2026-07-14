# Task: 普通聊天补充主流 AI 厂商

## Background

普通聊天已经内置 OpenAI、Anthropic、Gemini、DeepSeek、MiniMax、Kimi、智谱、百炼和 OpenRouter，但常用厂商目录仍缺少火山方舟、硅基流动、Xiaomi MiMo 等主流服务，用户只能手工创建自定义供应商，无法直接选择官方地址和常用 Coding/Token Plan 渠道。

## Objective

补充火山方舟、硅基流动、Xiaomi MiMo 等主流厂商模板、渠道、图标和模型发现验证

## Scope

In scope:

- 新增火山方舟 / 豆包、SiliconFlow、Xiaomi MiMo、阶跃星辰、魔搭 ModelScope、百度千帆、xAI、Mistral、NVIDIA NIM。
- 对厂商已明确提供的国内/国际、标准/Coding Plan/Token Plan 渠道分别预置，继续由“厂商、渠道、接口类型”独立选择。
- API 地址、API Key 页面和文档链接只使用官方入口，不加入中转商、邀请链接或合作推广渠道。
- Coding/Token Plan 没有稳定模型列表接口时提供官方常用模型目录，仍允许用户手工添加模型。
- 从 MIT 许可的 CC Switch 图标子集补充品牌 SVG，并保持无图标时的现有回退。
- 厂商搜索支持中文名、英文名、渠道、协议和 API 地址。

Out of scope:

- Azure OpenAI、AWS Bedrock、Google Vertex 等需要资源级 URL、云账号签名或 OAuth 的配置。
- 不加入小型中转站、共享 Token 渠道或合作推广链接。
- 不修改 Agent Provider、已有普通聊天供应商实例或默认供应商。

## Impact

- Backend：普通聊天供应商模板与 Coding/Token Plan 静态模型目录。
- Frontend：品牌图标映射和厂商搜索结果。
- Compatibility：仅增加新模板，不迁移或覆盖已有供应商配置。
- Security：不保存任何预置密钥，不在链接中包含邀请或推广参数。

## Acceptance Criteria

- [x] 搜索“火山”“硅基”“MiMo”等关键词能找到对应厂商并显示品牌图标。
- [x] 火山方舟、SiliconFlow 和 MiMo 的渠道与接口类型切换能自动填充正确官方 URL。
- [x] MiMo Token Plan、火山 Agent Plan、阶跃 Step Plan 和千帆 Coding Plan 可获取预置模型目录。
- [x] 新增厂商均使用官方 API Key 和文档入口，没有合作推广链接。
- [x] 原有 9 个厂商、模型发现、多选添加和同厂商多配置不受影响。
- [x] Rust 模板/模型测试、前端搜索测试、TypeScript 检查和浏览器验收通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/provider-template-search.test.ts src/lib/ordinary-chat-settings.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat::provider::tests`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- Playwright 验证厂商搜索、图标、渠道、接口类型和 URL 自动填充。

## Implementation Record

- 2026-07-14T15:48:34.393Z 补充火山 Agent Plan、MiMo Token Plan、阶跃 Step Plan、千帆 Coding Plan 的预置模型目录；新增品牌 SVG，MiMo 横向字标适配为方形小尺寸字形。
- 2026-07-14T15:48:34.035Z 对照本地 CC Switch 精选新增 9 个主流厂商、17 个官方渠道模板；排除需要资源级云签名的厂商和中转推广渠道。

- 2026-07-14T15:11:45.055Z Task created by Trellis automation.

## Verification Results

- 2026-07-14T15:48:35.801Z `Playwright 主流厂商浏览器验收`: 通过：火山、MiMo、硅基搜索唯一命中；品牌图标可见；标准、国际、Agent Plan、Token Plan、OpenAI Chat、Anthropic 切换 URL 正确；火山和 MiMo 预置模型弹窗正常；控制台 0 错误。
- 2026-07-14T15:48:35.449Z `cargo fmt --check；git diff --check；敏感信息和推广链接扫描`: 通过：格式和 diff 检查无错误，敏感值与供应商推广链接匹配均为 0。

- 2026-07-14T15:48:35.105Z `npm run typecheck；node --import tsx --test src/lib/provider-template-search.test.ts src/lib/ordinary-chat-settings.test.ts`: 通过：TypeScript 无错误，18 项前端设置和搜索测试全部通过。
- 2026-07-14T15:48:34.758Z `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat`: 通过：42 项普通聊天 Rust 测试全部通过，供应商模板共 42 个、厂商共 18 个且组合唯一。

## Completion Summary
- 2026-07-14T15:49:07.372Z 普通聊天内置厂商从 9 个扩展到 18 个，新增火山/豆包、SiliconFlow、Xiaomi MiMo、阶跃、魔搭、千帆、xAI、Mistral、NVIDIA，共补充 17 个官方渠道模板与 9 组品牌图标；Coding/Token Plan 预置模型、搜索和渠道/协议 URL 联动均完成。42 项 Rust 测试、18 项前端测试、TypeScript、格式、敏感信息扫描和浏览器验收全部通过。

## Follow-ups

- 无。
