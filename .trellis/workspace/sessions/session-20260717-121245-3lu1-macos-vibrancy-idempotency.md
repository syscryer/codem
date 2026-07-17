# Session Record: 修复 macOS vibrancy 视图累积卡死

- Session: session-20260717-121245-3lu1
- Started: 2026-07-17T12:12:45.910Z
- Task: .trellis/tasks/macos-vibrancy-idempotency.md

## Notes

- 2026-07-17T12:18:56.556Z 已完成双层幂等修复：workspace toast 回调改为稳定 useCallback；App 窗口材质 effect 增加已应用材质门闩；macOS Rust 状态改为 Option 并在同值请求时跳过，应用前循环清理全部历史 vibrancy 层。
- 2026-07-17T12:13:36.743Z 确认根因：useWorkspaceState.showToast 每次 render 重建，App 窗口材质 effect 因依赖变化反复 invoke；window-vibrancy 0.6 apply_vibrancy 每次无条件 addSubview 新 NSVisualEffectView，启动状态更新和 5 秒轮询导致 macOS 原生模糊层持续累积。当前系统无内存压力、~/.claude 无历史数据，排除会话导入和常驻内存为主因。

- 2026-07-17T12:12:45.912Z Session started.

## Verification
- 2026-07-17T12:25:40.490Z `macOS 修复后二进制受控启动与 CPU/RSS 采样`: 通过：连续约 90 秒采样，CodeM RSS 约 156.1-158.2 MB 后稳定，WindowServer 约 214-216 MB 无持续爬升；Web、health、workspace bootstrap 均返回 200。

- 2026-07-17T12:25:40.197Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：Rust 格式与差异空白检查无错误。
- 2026-07-17T12:25:39.881Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 153 passed、1 ignored；main 11 passed；其余 0 failed。

- 2026-07-17T12:25:39.573Z `npm run typecheck`: 通过：tsc -b 无错误。
- 2026-07-17T12:25:39.270Z `node --import tsx --test src/lib/window-material.test.ts src/lib/macos-vibrancy-idempotency.test.ts`: 通过：24 项窗口材质与 macOS 幂等守门测试全部通过。

## Completed

- 2026-07-17T12:25:57.778Z 修复 macOS 原生 vibrancy 视图随 React 重渲染持续叠加的问题：稳定 toast 回调，前端按实际材质变化调用，Rust 同值跳过并清理全部旧层后再应用；补充前端与 Rust 回归测试，完成全量验证及受控资源采样，修复后二进制已启动。
