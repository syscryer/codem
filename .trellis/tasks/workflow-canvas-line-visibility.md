# Task: 修复工作流画布连线可见性

## Background

工作流画布的默认“下一步”连线在浅色主题下不可见，但带有硬编码颜色的“满足条件”回路仍能显示。排查发现工作流样式引用了未定义的 `--app-text-muted` 变量，导致默认边的 stroke 声明失效。

## Objective

让工作流画布所有执行路径在浅色主题下清晰可见，并保留不同条件的颜色区分。

## Scope

In scope:

- 修正工作流画布的默认边、箭头、标签和图例颜色。
- 复用现有 `--app-muted` / `--app-text` / `--accent` 主题变量，保持条件颜色区分。
- 在浏览器中确认默认路径的实际计算样式与视觉结果。

Out of scope:

- 不调整工作流拓扑、节点布局、交互或后端 Mock 边界。

## Impact

- frontend：仅修改 `src/styles.css` 中工作流画布局部样式；无后端、网络和持久化影响。

## Acceptance Criteria

- [x] 默认“下一步”连线和箭头在浅色主题画布上可见。
- [x] “满足条件”和“继续修订”仍保持绿色、琥珀色的语义区分。
- [x] 主题变量未定义时不再导致边的 stroke 声明失效。
- [x] 类型检查、生产构建、针对性测试、差异检查和浏览器验收通过。

## Verification Commands

- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Playwright：1440x900 工作流画布截图与默认边计算样式检查

## Implementation Record
- 2026-08-11T17:40:45.595Z 2026-08-12 浏览器截图确认开始到 Agent 任务的默认路径清晰可见，满足条件回路仍为绿色；Playwright 计算样式确认默认路径 stroke=rgb(119, 115, 108)、stroke-width=1.8px。

- 2026-08-11T17:40:44.922Z 2026-08-12 已将工作流 React Flow 默认边、箭头、标签和图例切换到 --app-muted、--app-text、--accent 主题变量，并将默认边宽设为 1.8px；不改变拓扑和交互。
- 2026-08-11T17:40:44.266Z 2026-08-12 已定位连线不可见根因：工作流默认边使用未定义的 --app-text-muted，stroke 声明被浏览器丢弃；满足条件/继续修订因使用显式颜色仍可见。

- 2026-08-11T17:36:03.503Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T17:40:49.173Z `Playwright：1440x900 工作流画布截图；默认边 stroke=rgb(119, 115, 108)、stroke-width=1.8px`: 通过

- 2026-08-11T17:40:48.428Z `git diff --check`: 通过
- 2026-08-11T17:40:47.673Z `npm run build`: 通过；仅有既有分包体积与 Tauri 动态导入提示

- 2026-08-11T17:40:46.965Z `npm run typecheck`: 通过
- 2026-08-11T17:40:46.299Z `node --import tsx --test src/lib/workflow-prototype.test.ts`: 3 项测试通过

## Completion Summary
- 2026-08-11T17:40:57.952Z 工作流画布连线可见性已修复：默认边和箭头改用现有主题变量并提升到 1.8px，浏览器确认浅色画布可见且条件颜色保持区分；类型检查、构建、测试、差异检查全部通过。

## Follow-ups

- 暂无；如后续统一主题变量命名，可再处理仓库其他历史 `--app-text-muted` 引用。
