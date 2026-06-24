# Session Record: 移除 GLM-5.2 专项硬编码

- Session: session-20260622-061550-hkvf
- Started: 2026-06-22T06:15:50.531Z
- Task: .trellis/tasks/model-capabilities-no-hardcoded-glm.md

## Notes
- 2026-06-22T06:20:08.804Z 按反馈移除 GLM-5.2 专项硬编码：裸供应商模型不再由代码猜测窗口大小；1M 统计改由运行时 modelContextWindow 或用户模型能力 contextWindowTokens 驱动，显式 [1m] alias 仍按 1M 处理。

- 2026-06-22T06:15:50.535Z Session started.

## Verification
- 2026-06-22T06:24:25.340Z `git diff --check`: 通过，仅有 Windows LF/CRLF 提示

- 2026-06-22T06:24:06.944Z `npm run typecheck`: 通过
- 2026-06-22T06:22:58.429Z `npx tsx --test server/lib/settings-store.test.ts tests/useAppSettings.test.ts src/lib/claude-model-options.test.ts server/lib/claude-models.test.ts src/lib/composer-context-usage.test.ts src/lib/claude-model-selection.test.ts src/lib/ui-labels.test.ts src/hooks/useClaudeRun.send-latency.test.ts`: 通过，77/77 tests passed

## Completed

- 2026-06-22T06:24:45.299Z 已移除 GLM-5.2 专项上下文窗口硬编码。供应商裸模型默认不猜测窗口大小；小圆环优先使用运行时 modelContextWindow，其次使用用户模型能力配置 contextWindowTokens；显式 [1m] alias 仍按 1M 处理。
