# Task: 修复 macOS vibrancy 视图累积卡死

## Background

macOS 桌面版打开后会逐步卡顿，严重时拖累整机。前端窗口材质 effect 依赖 `useWorkspaceState` 每次渲染都会重新创建的 `showToast`，因此 App 任意状态更新都会再次调用 Tauri `set_window_material`。macOS `window-vibrancy 0.6` 的 `apply_vibrancy` 每次都会新建 `NSVisualEffectView` 并添加为子视图，不会自动去重；启动加载与 5 秒状态轮询会持续叠加原生模糊层。Windows DWM 材质设置不创建重复子视图，因此没有同样问题。

## Objective

确保窗口材质只在真实变化时应用，并在 Rust 层防止 NSVisualEffectView 重复叠加，消除 macOS 界面逐步卡顿和整机假死风险

## Scope

In scope:

- 将 `showToast`、toast 关闭和详情展开操作稳定为 React callback，避免无关 effect 反复失效。
- 前端窗口材质 effect 只在加载完成或实际材质发生变化时调用原生 API。
- macOS Rust 材质状态区分“尚未应用”和具体材质；相同材质重复请求直接返回。
- 应用 vibrancy 前清理所有由 `window-vibrancy` 标记的旧视图，确保最多保留一个模糊层。
- 补充前端源码守门测试与 Rust 纯状态/幂等测试。

Out of scope:

- 不改变 macOS 默认玻璃视觉、标题栏布局、窗口透明配置或 Windows 材质行为。
- 不调整 Agent 轮询频率、会话渲染或数据库流程。
- 不引入新的用户设置或性能模式。

## Impact

- Frontend: `src/hooks/useWorkspaceState.ts`、`src/App.tsx`、窗口材质测试。
- Desktop: `src-tauri/src/main.rs` macOS 原生材质状态与清理逻辑。

## Acceptance Criteria

- [x] `showToast` 在 workspace state 重渲染时保持引用稳定。
- [x] App 普通状态更新不会重复调用相同窗口材质。
- [x] Rust 层相同材质请求不重复执行原生 vibrancy 操作。
- [x] 切换到无材质会清除全部历史 vibrancy 视图；重新启用后最多新增一个。
- [x] Windows 和非 macOS 路径行为保持不变。
- [x] TypeScript、窗口材质定向测试、Rust 全量测试、格式和差异检查通过。
- [x] macOS 最新桌面二进制启动后，静置与交互期间 CPU/RSS 不持续爬升且界面保持响应。

## Verification Commands

- `node --import tsx --test src/lib/window-material.test.ts src/lib/macos-vibrancy-idempotency.test.ts`
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- macOS 桌面受控启动与 CPU/RSS 采样。

## Implementation Record

- 2026-07-17T12:18:56.556Z 已完成双层幂等修复：workspace toast 回调改为稳定 useCallback；App 窗口材质 effect 增加已应用材质门闩；macOS Rust 状态改为 Option 并在同值请求时跳过，应用前循环清理全部历史 vibrancy 层。
- 2026-07-17T12:13:36.743Z 确认根因：useWorkspaceState.showToast 每次 render 重建，App 窗口材质 effect 因依赖变化反复 invoke；window-vibrancy 0.6 apply_vibrancy 每次无条件 addSubview 新 NSVisualEffectView，启动状态更新和 5 秒轮询导致 macOS 原生模糊层持续累积。当前系统无内存压力、~/.claude 无历史数据，排除会话导入和常驻内存为主因。

- 2026-07-17T12:12:45.911Z Task created by Trellis automation.

## Verification Results
- 2026-07-17T12:25:40.490Z `macOS 修复后二进制受控启动与 CPU/RSS 采样`: 通过：连续约 90 秒采样，CodeM RSS 约 156.1-158.2 MB 后稳定，WindowServer 约 214-216 MB 无持续爬升；Web、health、workspace bootstrap 均返回 200。

- 2026-07-17T12:25:40.197Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 通过：Rust 格式与差异空白检查无错误。
- 2026-07-17T12:25:39.881Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 153 passed、1 ignored；main 11 passed；其余 0 failed。

- 2026-07-17T12:25:39.573Z `npm run typecheck`: 通过：tsc -b 无错误。
- 2026-07-17T12:25:39.270Z `node --import tsx --test src/lib/window-material.test.ts src/lib/macos-vibrancy-idempotency.test.ts`: 通过：24 项窗口材质与 macOS 幂等守门测试全部通过。

## Completion Summary
- 2026-07-17T12:25:57.778Z 修复 macOS 原生 vibrancy 视图随 React 重渲染持续叠加的问题：稳定 toast 回调，前端按实际材质变化调用，Rust 同值跳过并清理全部旧层后再应用；补充前端与 Rust 回归测试，完成全量验证及受控资源采样，修复后二进制已启动。

## Follow-ups

- 后续可用 Instruments/Core Animation 评估弹层局部 backdrop-filter，但不应和本次原生视图泄漏修复混在一起。
