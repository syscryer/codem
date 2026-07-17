# Task: 补齐聊天区与后续设置页深色主题

## Background

深色主题已经覆盖桌面窗口材质、顶栏和基础设置页，但聊天内容以及“会话管理”之后的部分设置页仍保留硬编码浅色背景、边框和文字色，形成明显白块。用户确认需要继续补齐，同时要求保持现有交互体验，并且不能影响 Windows 和 Agent 安装链路。

## Objective

修复聊天消息内 Markdown、输出文件/变更卡片，以及会话管理、工作树、MCP、插件与技能、全局规则、打开方式页面的浅色残留；主题切换全局联动，不改变现有交互和布局。

## Scope

In scope:

- Markdown 表格、行内代码、引用、分隔线、代码复制按钮的主题色。
- 输出文件卡片、变更汇总、操作按钮和展开后 inline diff 的背景、边框、文字、hover 与滚动条颜色。
- 会话管理的项目列表、列表项、搜索框、批量操作区和状态文字。
- 工作树、MCP、插件与技能页面的提示条、错误条、标签、工具栏、表单、列表、徽标与操作按钮。
- 打开方式页面的目标条目、图标、按钮和禁用态；同步复核全局规则页同类控件。
- 使用统一主题变量，并增加 CSS 源码守门测试。

Out of scope:

- 不调整组件结构、布局、尺寸、文案和事件行为。
- 不修改聊天数据流、会话管理逻辑、MCP/插件/工作树业务逻辑。
- 不修改 Windows 窗口材质实现、Agent 检测或安装链路。
- 不新增视觉特效或动画。

## Impact

- `src/styles.css` 统一桌面主题覆盖层。
- `src/lib/theme-consistency.test.ts` 与 `src/lib/window-material.test.ts` 中的主题一致性源码守门测试。
- 仅前端视觉层有行为影响，Windows 与 macOS 共用主题变量，业务逻辑保持不变。

## Acceptance Criteria

- [x] 深色主题下聊天区不再出现 Markdown 表头、行内代码、输出文件卡片或变更卡片的亮白残留。
- [x] 展开变更 diff 后，背景、行号、增删语义色和滚动条在深色主题下可读。
- [x] 深色主题下会话管理、工作树、MCP、插件与技能、全局规则、打开方式页面无明显浅色卡片、输入框或工具条残留。
- [x] hover、focus、active、disabled、error、success 等状态保留原有语义与交互反馈。
- [x] 浅色主题视觉不回归，布局、尺寸和交互行为不变。
- [x] Windows 平台与 Agent 安装链路不受影响。
- [x] 前端测试、typecheck、build 和 `git diff --check` 通过。

## Verification Commands

- `node --test --import tsx src/lib/theme-consistency.test.ts src/lib/window-material.test.ts`
- `rg --files src -g '*.test.ts' -0 | xargs -0 node --test --import tsx`
- `node node_modules/typescript/bin/tsc -b`
- `node node_modules/vite/bin/vite.js build`
- `tauri build --bundles app`
- `git diff --check`

## Implementation Record
- 2026-07-17T15:30:56.595Z 已在统一主题层补齐聊天 Markdown、输出文件/变更卡片、inline diff，以及会话管理、工作树、MCP、插件与技能、全局规则、打开方式页面的主题变量；只调整颜色、边框和状态反馈，未改布局或业务逻辑。

- 2026-07-17T15:19:16.736Z Task created by Trellis automation.
- 2026-07-17T15:32:00.000Z 根据用户追加反馈，将范围扩展为聊天区与“会话管理”之后的设置页；坚持只改视觉变量，不改交互与业务逻辑。

## Verification Results
- 2026-07-17T15:39:21.406Z `git diff --check`: 通过，无空白错误。

- 2026-07-17T15:37:57.221Z `Computer Use release CodeM.app visual QA`: 深色聊天、inline diff、会话管理、工作树、MCP、插件与技能、全局规则、打开方式逐页通过；浅色回归通过后恢复深色。
- 2026-07-17T15:37:57.200Z `tauri build --bundles app`: 清理 release 缓存后成功构建 macOS CodeM.app；仅有既有 Rust unused/dead_code 警告。

- 2026-07-17T15:37:57.187Z `/Users/mars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js build`: Vite 生产构建通过，仅有既有 chunk 大小提示。
- 2026-07-17T15:37:57.165Z `rg --files src -g '*.test.ts' -0 | xargs -0 /Users/mars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --import tsx`: 全量前端测试 543/543 通过。

- 2026-07-17T15:37:57.155Z `/Users/mars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --import tsx src/lib/theme-consistency.test.ts src/lib/window-material.test.ts`: 定向主题测试 30/30 通过。
- 2026-07-17T15:37:57.147Z `/Users/mars/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc -b`: TypeScript 类型检查通过。

## Completion Summary
- 2026-07-17T15:39:35.347Z 补齐聊天 Markdown、输出文件/变更卡片和展开 Diff，以及会话管理后续设置页的深色主题；仅调整主题变量与语义状态色，未改布局、交互、Windows 材质或 Agent 安装链路。定向测试 30/30、全量前端 543/543、typecheck、build、macOS release 打包与逐页实机验收均通过。

## Follow-ups

- 无。本次范围已覆盖；后续新增聊天卡片或设置子页时继续复用统一主题变量。
