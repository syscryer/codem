# Task: 修复 Markdown 代码块横向滚动回弹

## Background

聊天消息中的宽代码块使用原生横向滚动条。Markdown 自定义 `pre` 渲染器此前定义在 `DeferredMarkdownContent` 每次 render 创建的对象字面量中；会话计时、流式增量或其他父级刷新会生成新的组件函数，React 因而卸载并重新挂载代码块，浏览器的 `scrollLeft` 被重置为 0。

## Objective

保持聊天消息代码块在会话刷新和流式更新时的横向滚动位置

## Scope

In scope:

- 稳定 Markdown 链接、图片和代码块的自定义渲染器引用。
- 保持宽代码块在无内容变化的会话刷新中的横向滚动位置。
- 增加渲染性能回归测试，禁止重新引入内联 `pre` 组件。

Out of scope:

- 不改变代码块配色、尺寸或滚动条视觉样式。
- 不修改会话整体纵向自动跟随策略。
- 不为内容真实变化强行恢复已经失效的横向位置。

## Impact

- Frontend: `src/components/ConversationTurn.tsx` 的 Markdown 渲染组件稳定性。
- Tests: `src/components/ConversationStreaming.render-perf.test.ts`。
- Backend/API/persistence: 无变化。

## Acceptance Criteria

- [x] 宽代码块向右拖动后，不会因会话计时或父组件刷新自动回到左侧。
- [x] Markdown 链接、图片、复制代码功能保持正常。
- [x] TypeScript 类型检查和定向回归测试通过。
- [x] 桌面/Web 开发界面无运行时错误，并完成真实横向滚动交互验证。

## Verification Commands

- `node --test --import tsx src/components/ConversationStreaming.render-perf.test.ts`
- `npm run typecheck`
- `git diff --check`
- Playwright：设置宽代码块 `scrollLeft`，等待会话刷新后确认位置不变。

## Implementation Record
- 2026-08-04T10:30:07.827Z 已将 Markdown pre 渲染器提升为稳定组件，memoize 组件映射并稳定链接回调，避免父级刷新导致代码块 DOM 重建和 scrollLeft 归零。

- 2026-08-04T10:06:57.974Z Task created by Trellis automation.

## Verification Results
- 2026-08-04T10:30:38.306Z `Playwright wide code block refresh`: pass: scrollLeft 240 preserved, same DOM node, console 0 errors/warnings

- 2026-08-04T10:30:25.585Z `node --test --import tsx src/components/ConversationStreaming.render-perf.test.ts`: pass (5/5)
- 2026-08-04T10:30:18.084Z `npm run typecheck`: pass

- `npm run typecheck`: passed.
- `node --test --import tsx src/components/ConversationStreaming.render-perf.test.ts`: 5/5 passed.
- `git diff --check -- src/components/ConversationTurn.tsx src/components/ConversationStreaming.render-perf.test.ts .trellis/tasks/markdown-code-scroll-position.md`: passed; only existing LF/CRLF conversion warnings.
- Playwright real-history check: a `3790px` wide code block in an `820px` viewport retained `scrollLeft = 240` after a UI refresh and three-second wait; the viewport then narrowed to `419px`, while the same DOM node remained connected and kept the same scroll position.
- Browser console: 0 errors, 0 warnings. Web and backend health checks returned HTTP 200; desktop dev process remained running.

## Completion Summary
- 2026-08-04T10:30:48.757Z 修复 Markdown 宽代码块在会话刷新时横向滚动位置归零；稳定 renderer 和回调引用，新增回归测试，并完成真实历史代码块交互验收。

- Moved the Markdown `pre` renderer to the stable top-level `MarkdownCodeBlock` component and memoized the renderer map.
- Stabilized link and context-menu callbacks so unchanged deferred Markdown content is not remounted during parent refreshes.
- Added a source-level regression test that prevents reintroducing an inline `pre` renderer.

## Follow-ups

- 暂无。
