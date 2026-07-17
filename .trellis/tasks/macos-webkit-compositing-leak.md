# Task: 修复 macOS WebKit 合成层持续增长

## Background

修复原生 vibrancy 重复叠层后，macOS 桌面壳主进程 RSS 已稳定，但与 CodeM 同时启动的 WebKit WebContent 在 Claude Code 任务运行期间仍持续增长。实测 WebContent 30 秒从约 592 MB 增至 650 MB，随后 12 秒从约 1.19 GB 增至 1.29 GB；CPU 常驻 13%–28%，WebKit GPU 约 9%–11%，WindowServer 约 35%–43%。用户确认采样期间正在运行 CC 任务；任务结束后 WebContent 约 1.58 GB 且静置 30 秒未回收，而对应线程持久化历史仅约 475 KB / 9 turns，说明流式 Markdown/工具 DOM 与事件区域的高频重建存在明显放大和内存滞留。初始 WebKit sample 主要热栈为 `OpacityCaretAnimator -> recomputeCaretRect -> resolveStyle -> updateCompositingLayers`；移除重复 CSS app-region 后静置 CPU 显著回落，剩余运行期热栈转为 JavaScript 事件流和 JSON 解析。

## Objective

消除设置页输入光标触发的持续合成更新，确保 WebContent、GPU 与 WindowServer 在静置时保持低占用且内存不持续增长

## Scope

In scope:

- 定位设置页当前焦点元素、拖拽区和合成层样式之间的触发关系。
- 避免 macOS 设置页的输入光标闪烁引发整页拖拽事件区域与合成层持续重建。
- 在保持流式 Markdown 完整排版与交互的前提下，避免相同 deferred 内容被重复解析和重建 DOM。
- 设置页打开时冻结不可见工作区的 React 渲染，同时保留运行状态、DOM 和本地 UI state。
- 保持设置页顶部整窗可拖拽，交互控件仍可点击、输入和选择。
- 补充源码守门测试，并对修复后的桌面进程、WebContent、GPU、WindowServer 做对照采样。

Out of scope:

- 不移除 macOS 原生 vibrancy 或改变 Windows 窗口材质行为。
- 不调整会话轮询、后端 API、数据库或 Agent 运行流程。
- 不以关闭全部输入光标、禁用所有动画或降低整体视觉质量作为常态兜底。

## Impact

- Frontend: 设置页/标题栏拖拽结构、macOS 桌面专属样式及窗口材质测试。
- Desktop runtime: 仅用于受控启动和性能验证，原则上不新增 Rust 行为。

## Acceptance Criteria

- [x] macOS 设置页右侧顶部空白区仍可拖动窗口。
- [x] 设置页输入、选择和按钮交互不被拖拽层遮挡。
- [x] 静置至少 60 秒时 WebContent RSS 不再线性增长，CPU 回落到合理空闲水平。
- [x] CC 流式阶段始终保留完整 Markdown、链接和代码块交互，同时避免相同内容重复解析。
- [x] 设置页打开期间后台 CC 任务继续运行，但不可见工作区不执行高频 React 子树渲染。
- [x] WebKit GPU 与 WindowServer 不再因 CodeM 设置页持续高占用。
- [x] CodeM 主进程、Windows 和 Web 模式行为不回归。
- [x] TypeScript、定向测试、格式和差异检查通过。

## Verification Commands

- `node --import tsx --test src/lib/window-material.test.ts src/lib/macos-webkit-compositing.test.ts`
- `npm run typecheck`
- `git diff --check`
- macOS 桌面受控启动；采样 CodeM、WebContent、GPU、WindowServer CPU/RSS 至少 60 秒。
- WebKit sample 对照 caret/compositing 热栈。

## Implementation Record
- 2026-07-17T13:51:05.989Z WindowServer 是系统级总进程，Computer Use 采样期间仍约 39%–42%，但在 CodeM WebContent/GPU/主进程均回落到 0% 且 RSS 完全稳定时仍保持同一水平，未再与 CodeM 光标或流式阶段同步增长；因此不把该系统总值单独归因于 CodeM。

- 2026-07-17T13:50:01.321Z 通过 CodeM 控制现有贪吃蛇线程执行 8 项可发布级增强，覆盖长思考、批量工具、1528 行 Diff、Markdown 表格/列表/代码块及约 9 分钟持续运行。保持完整流式 Markdown 和所有交互；设置页切换期间任务不断，返回后最新输出一次同步。
- 2026-07-17T13:27:01.594Z 实现交互无损的 WebKit 性能修复：移除与 Tauri 原生拖拽重复的 CSS app-region；新增 PersistentHiddenView，在设置页期间保留工作区 DOM/state 但冻结其 React 子树；将完整 ReactMarkdown 渲染器置于 memo 边界，继续实时 Markdown 交互但避免相同 deferred 内容重复解析；相同 runtime status 不再提交 React state。

- 2026-07-17T13:22:39.976Z 按用户要求先同步远端：通过 127.0.0.1:7890 代理 fetch，main 从 6057c86 快进到 be25f16；本地全部 tracked/untracked 改动经 stash 恢复，无冲突。远端新增运行卸载清理、重连 abort 和完成回合持久化修复，后续性能修复基于该版本继续。
- 2026-07-17T13:10:01.865Z 性能基线：macOS 设置页静置时 WebContent RSS 30 秒 592→650 MB，后续 12 秒 1.19→1.29 GB，CPU 13%–28%；sample 主要落在 OpacityCaretAnimator 驱动的 resolveStyle/updateCompositingLayers，并伴随 updateEventRegions。代码存在与 Tauri data-tauri-drag-region 重复的全局 -webkit-app-region drag/no-drag 体系，所有输入控件均参与 WebKit 事件区域计算。

- 2026-07-17T13:07:22.373Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T13:50:22.411Z `node --import tsx --test src/**/*.test.ts；npm run build；cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast；cargo fmt --check；git diff --check`: 全部通过：前端 535/535；Rust lib 154 passed、1 ignored，desktop main 11/11；生产构建成功；Rust 格式和差异检查无错误。
- 2026-07-17T13:50:12.723Z `CodeM 真实 CC 压力测试与进程采样`: 修复后流式可见阶段 WebContent 约 163→308 MB 后平台化，未复现修复前 1.19→1.29 GB/12s 的线性增长；设置页聚焦输入框 86 秒时 WebContent 最终稳定约 316.8 MB，WebContent/GPU CPU 多为 1%–2%；最终长回复同步后空闲 90 秒 WebContent 固定 329408 KB、GPU 86256 KB、主进程 146464 KB，三者 CPU 均为 0%。

## Completion Summary
- 2026-07-17T13:51:36.847Z 完成 macOS WebKit 合成与流式渲染性能修复：移除重复 CSS app-region，保留 Tauri 原生拖拽；设置页冻结隐藏工作区但保留 DOM/state；完整 Markdown memo 化；相同 runtime 状态跳过提交。真实 CodeM 长任务未复现线性内存增长，设置页输入焦点和返回同步正常，最终空闲进程稳定，前端 535/535、Rust 与生产构建全部通过。

## Follow-ups

- 若仍有非线性缓存增长，再使用 Safari Web Inspector 对具体 DOM 图层和 focus owner 做二次分析。
