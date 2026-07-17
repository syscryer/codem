# Session Record: 修复 macOS WebKit 合成层持续增长

- Session: session-20260717-130722-o67i
- Started: 2026-07-17T13:07:22.373Z
- Task: .trellis/tasks/macos-webkit-compositing-leak.md

## Notes
- 2026-07-17T13:51:05.989Z WindowServer 是系统级总进程，Computer Use 采样期间仍约 39%–42%，但在 CodeM WebContent/GPU/主进程均回落到 0% 且 RSS 完全稳定时仍保持同一水平，未再与 CodeM 光标或流式阶段同步增长；因此不把该系统总值单独归因于 CodeM。

- 2026-07-17T13:50:01.321Z 通过 CodeM 控制现有贪吃蛇线程执行 8 项可发布级增强，覆盖长思考、批量工具、1528 行 Diff、Markdown 表格/列表/代码块及约 9 分钟持续运行。保持完整流式 Markdown 和所有交互；设置页切换期间任务不断，返回后最新输出一次同步。
- 2026-07-17T13:27:01.594Z 实现交互无损的 WebKit 性能修复：移除与 Tauri 原生拖拽重复的 CSS app-region；新增 PersistentHiddenView，在设置页期间保留工作区 DOM/state 但冻结其 React 子树；将完整 ReactMarkdown 渲染器置于 memo 边界，继续实时 Markdown 交互但避免相同 deferred 内容重复解析；相同 runtime status 不再提交 React state。

- 2026-07-17T13:22:39.976Z 按用户要求先同步远端：通过 127.0.0.1:7890 代理 fetch，main 从 6057c86 快进到 be25f16；本地全部 tracked/untracked 改动经 stash 恢复，无冲突。远端新增运行卸载清理、重连 abort 和完成回合持久化修复，后续性能修复基于该版本继续。
- 2026-07-17T13:10:01.865Z 性能基线：macOS 设置页静置时 WebContent RSS 30 秒 592→650 MB，后续 12 秒 1.19→1.29 GB，CPU 13%–28%；sample 主要落在 OpacityCaretAnimator 驱动的 resolveStyle/updateCompositingLayers，并伴随 updateEventRegions。代码存在与 Tauri data-tauri-drag-region 重复的全局 -webkit-app-region drag/no-drag 体系，所有输入控件均参与 WebKit 事件区域计算。

- 2026-07-17T13:07:22.374Z Session started.

## Verification

- 2026-07-17T13:50:22.411Z `node --import tsx --test src/**/*.test.ts；npm run build；cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast；cargo fmt --check；git diff --check`: 全部通过：前端 535/535；Rust lib 154 passed、1 ignored，desktop main 11/11；生产构建成功；Rust 格式和差异检查无错误。
- 2026-07-17T13:50:12.723Z `CodeM 真实 CC 压力测试与进程采样`: 修复后流式可见阶段 WebContent 约 163→308 MB 后平台化，未复现修复前 1.19→1.29 GB/12s 的线性增长；设置页聚焦输入框 86 秒时 WebContent 最终稳定约 316.8 MB，WebContent/GPU CPU 多为 1%–2%；最终长回复同步后空闲 90 秒 WebContent 固定 329408 KB、GPU 86256 KB、主进程 146464 KB，三者 CPU 均为 0%。

## Completed

- 2026-07-17T13:51:36.847Z 完成 macOS WebKit 合成与流式渲染性能修复：移除重复 CSS app-region，保留 Tauri 原生拖拽；设置页冻结隐藏工作区但保留 DOM/state；完整 Markdown memo 化；相同 runtime 状态跳过提交。真实 CodeM 长任务未复现线性内存增长，设置页输入焦点和返回同步正常，最终空闲进程稳定，前端 535/535、Rust 与生产构建全部通过。
