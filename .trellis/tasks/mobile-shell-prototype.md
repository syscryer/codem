# Task: 移动端聊天外壳原型重做

## Background

现有移动端把任务列表、聊天消息、Thinking、工具卡片和 Composer 全部重新设计成了大量玻璃化的独立视觉体系，与 CodeM 桌面端对话体验割裂，也增加了两套聊天渲染长期漂移的风险。用户要求回退当前视觉方向，聊天内容尽量保持桌面版样式，只为手机重做外壳。

## Objective

回退当前移动端玻璃化实现，保留桌面端聊天渲染语义，先实现正常苹果风格的移动任务列表、详情外壳和新建入口原型，不接入新的后端协议。

## Scope

In scope:

- 新增无需配对即可访问的 `/mobile/prototype` 可运行原型。
- 原型包含任务首页、任务状态分组、会话详情、返回导航和移动 Composer。
- 会话详情复用桌面端 `ConversationTurnView`，用静态数据展示用户消息、Agent 回复、Thinking 和工具摘要。
- 采用正常 iOS 原生应用风格：实色背景、分组列表、轻边框和轻阴影，不使用大面积玻璃化或彩色渐变。
- 支持 375px 宽度、安全区、至少 44px 触控区域和深浅主题。

Out of scope:

- 不替换当前真实 `/mobile` 路由。
- 不修改配对、Token、设备权限、SSE、任务 API 或 Rust 后端。
- 不实现真实发送、停止、审批或用户输入提交。
- 不引入 Tailwind、shadcn 或新的 UI 依赖。

## Impact

- frontend：`src/main.tsx` 增加原型路由，`src/mobile/prototype/**` 增加独立原型组件，`src/mobile/mobile.css` 增加原型外壳样式。
- desktop：桌面入口和桌面样式保持不变。
- backend：无改动。

## Acceptance Criteria

- [ ] `/mobile/prototype` 无需配对即可打开。
- [ ] 任务首页能进入会话详情并正常返回。
- [ ] 会话内容复用桌面端 `ConversationTurnView`，不再使用独立移动聊天气泡体系。
- [ ] 视觉为克制的 iOS 原生风格，不出现大面积玻璃、彩色环境光或渐变卡片。
- [ ] 375px 宽度无横向溢出，主要触控区域至少 44px。
- [ ] 深浅主题均可阅读，减少动效设置生效。
- [ ] `npm run typecheck` 和 `npm run build` 通过。

## Verification Commands

- `npm run typecheck`
- `npm run build`
- 浏览器以 375x812 打开 `/mobile/prototype`，检查首页、详情和返回操作。

## Implementation Record

- 2026-07-19T18:23:23.876Z 完成独立移动原型：新增 /mobile/prototype，无需配对；首页采用常规 iOS 实色分组列表和四项底栏；详情直接复用桌面 ConversationTurnView，并提供本地可交互 Composer。修复桌面根容器网格和材质伪元素对移动原型的布局与清晰度影响。
- 2026-07-19T18:10:21.228Z 用户明确采用 uiuxpromax 作为设计参考；原型不引入新 UI 依赖，使用 CodeM 现有 CSS 变量与桌面 ConversationTurnView。新增 /mobile/prototype 静态入口，先验证任务外壳和对话视觉，不修改真实配对、SSE 或 Rust 后端。

- 2026-07-19T18:07:19.162Z Task created by Trellis automation.

## Verification Results

- 2026-07-19T18:23:25.645Z `git diff --check`: 通过；仅显示已有 Cargo.toml 与 main.tsx 行尾转换提示。
- 2026-07-19T18:23:25.163Z `375x812 浏览器验证 /mobile/prototype`: 通过：首页、任务详情、返回、Thinking 展开和 Composer 本地发送正常；页面与滚动容器 scrollWidth 等于 clientWidth；控制台无错误。

- 2026-07-19T18:23:24.740Z `npm run build`: 通过，Vite 生产构建成功；仅有既有大 chunk 提示。
- 2026-07-19T18:23:24.303Z `npm run typecheck`: 通过，TypeScript 无错误。

## Completion Summary
- 2026-07-19T18:23:26.216Z 完成移动端外壳静态原型。原型使用 uiuxpromax 的移动优先和可访问性原则，但不引入新依赖；视觉改为正常 iOS 实色风格，会话正文复用桌面 ConversationTurnView。真实 /mobile、配对、SSE 和 Rust 后端未修改，等待用户确认后再替换接入。

## Follow-ups

- 用户确认原型视觉后，再用同一外壳替换真实 `/mobile` 页面，并逐步接回流式、审批和用户输入。
