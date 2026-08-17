# Task: 移动会话输入区对齐桌面能力

## Background

桌面会话输入区已经支持渠道、权限、模型、推理强度、上下文、附件等能力，移动任务详情目前只暴露权限与模型，且权限选择器的弹性宽度在附件按钮后形成明显空白。移动端应复用桌面业务目录和协议，但保持独立、适合触控的布局。

## Objective

移动任务详情复用桌面渠道、权限、模型、推理、上下文、附件和语音能力，同时保持移动布局与桌面前端隔离

## Scope

In scope:

- 移动任务详情补齐 Provider 标识、渠道、权限、模型、推理强度和上下文占用入口。
- 支持图片与安全尺寸内的文本/代码附件，复用统一 `contentBlocks` 请求结构。
- 运行中 guide 保持现有协议能力；协议未支持附件时明确禁用附件发送。
- 输入工具栏采用移动端紧凑布局，消除附件和权限之间的异常空白，并保证 375px 无横向页面溢出。
- 保持桌面 `Composer` 和桌面页面行为不变。

Out of scope:

- 手机本地文件映射为电脑路径。
- 大文件、二进制文件和 PDF/Word 深度解析。
- 语音识别实现；仅与桌面当前未开放状态保持一致。

## Impact

- Frontend: `src/mobile/**`，复用 `src/lib/**` 和现有上下文指示组件。
- Backend/API: 优先复用现有 mobile send/contentBlocks 协议，不扩大桌面 API 暴露面。
- Compatibility: 不修改桌面输入区布局、交互或路由。

## Acceptance Criteria

- [ ] 附件按钮与后续控件连续排列，不再出现固定弹性宽度造成的大块空白。
- [ ] 渠道、权限、模型和推理强度选项使用与桌面一致的数据源，并按所选渠道联动模型。
- [ ] 已有会话 Provider 固定展示；发送 payload 使用当前选中的渠道、模型、推理强度和权限。
- [ ] 显示会话上下文占用入口，弹层在 375px 宽度可用。
- [ ] 图片和小型文本附件可发送为统一 content blocks；运行中不允许发送会被 guide 协议丢失的附件。
- [ ] 语音入口呈现与桌面一致的未开放状态和无障碍说明。
- [ ] 移动端 375px/390px 无页面横向溢出，触控目标不小于 44px。
- [ ] 桌面端现有 Composer 和会话流程不受影响。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts`
- `npm run build`
- 浏览器验证 `/mobile/tasks/:threadId` 的 375px/390px 深浅主题和弹层布局。

## Implementation Record

- 2026-08-15T17:55:43.993Z 按用户截图调整移动会话布局：Provider/渠道/权限/模型/推理强度迁入右上角三点任务菜单；三点入口始终显示，运行中停止操作也进入菜单；Composer 底部恢复附件、语音、上下文、发送单行，并移除 就绪文案。保留附件 contentBlocks 与渠道会话隔离逻辑。
- 2026-08-15T17:39:00.447Z 修复移动会话输入区附件按钮后的异常空白：权限与模型选择器改为内容宽度并连续左排，发送按钮使用 margin-left:auto 固定在右侧；新增样式回归断言。桌面 Composer 与桌面样式未修改。

- 2026-08-15T17:31:16.053Z Task created by Trellis automation.

## Verification Results
- 2026-08-15T17:56:32.212Z `npm run typecheck; node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts; npm run build; cargo test --manifest-path src-tauri/Cargo.toml mobile_companion`: pass: typecheck; 27/27 mobile frontend tests; production build; 26/26 mobile gateway tests

## Completion Summary
- 2026-08-15T17:58:00.435Z 移动会话输入区已对齐桌面运行配置与 contentBlocks 能力：Agent/渠道/权限/模型/推理强度集中到右上三点菜单，Composer 保持附件/语音/上下文/发送单行；渠道切换避免复用错误 Codex 会话；桌面 UI 未修改。前端移动测试、类型检查、生产构建与移动网关 Rust 测试全部通过。

## Follow-ups

- 待补充。
