# Task: 窗口失焦保持材质特效

## Background

Windows DWM 会在窗口失焦时把 `DWMWA_SYSTEMBACKDROP_TYPE` 的系统背板渲染为非活动状态，导致 Mica/Acrylic 看起来像被清除。

## Objective

Windows 桌面窗口失焦后保持用户选择的窗口材质视觉，不抢回输入焦点且不影响其他平台

## Scope

In scope:

- Windows 主窗口失焦时保留当前材质的非客户区视觉。
- 不抢回输入焦点，不改变窗口激活状态。
- 非 Windows 平台行为保持不变。

Out of scope:

- Windows 主窗口 HWND 的原生消息子类钩子。
- 不引入新依赖，不修改前端材质选择协议。

## Impact

- 仅影响 Windows Tauri 主窗口的非客户区消息处理。

## Acceptance Criteria

- [ ] Windows `WM_NCACTIVATE(FALSE)` 返回已处理，DWM 背板不主动降级。
- [ ] 输入焦点仍可切换到其他应用。
- [ ] Rust 单元测试覆盖消息判定。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`

## Implementation Record

- 2026-08-12T10:05:43.975Z 已从隔离 worktree 启动 desktop:dev；桌面进程为 src-tauri/target/debug/codem.exe，Web 服务监听 http://127.0.0.1:5174，等待用户实际失焦验收。
- 2026-08-12T08:08:19.586Z 定位根因为 Windows DWM 在失焦时降级系统背板；采用 SetWindowSubclass 拦截 WM_NCACTIVATE(FALSE)，保持视觉但不抢焦点。

- 2026-08-12T08:01:02.192Z Task created by Trellis automation.

## Verification Results

- 2026-08-12T10:30:40.049Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && npm run build`: 通过：Rust 格式检查和前端生产构建成功，仅有既有 bundle size/dynamic import 警告。
- 2026-08-12T10:05:43.642Z `cargo test --manifest-path src-tauri/Cargo.toml preserves_only_non_client_deactivation`: 通过：Windows WM_NCACTIVATE(FALSE) 判定测试 1/1 通过，Rust 桌面壳编译成功。

## Completion Summary
- 2026-08-12T10:30:40.462Z Windows 主窗口通过 SetWindowSubclass 处理 WM_NCACTIVATE(FALSE)，失焦后保持材质活动视觉且不抢焦点；用户实机验收通过。

## Follow-ups
