# Session Record: 窗口失焦保持材质特效

- Session: session-20260812-080102-cdfp
- Started: 2026-08-12T08:01:02.190Z
- Task: .trellis/tasks/window-material-unfocused.md

## Notes

- 2026-08-12T10:05:43.975Z 已从隔离 worktree 启动 desktop:dev；桌面进程为 src-tauri/target/debug/codem.exe，Web 服务监听 http://127.0.0.1:5174，等待用户实际失焦验收。
- 2026-08-12T08:08:19.586Z 定位根因为 Windows DWM 在失焦时降级系统背板；采用 SetWindowSubclass 拦截 WM_NCACTIVATE(FALSE)，保持视觉但不抢焦点。

- 2026-08-12T08:01:02.198Z Session started.

## Verification

- 2026-08-12T10:30:40.049Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && npm run build`: 通过：Rust 格式检查和前端生产构建成功，仅有既有 bundle size/dynamic import 警告。
- 2026-08-12T10:05:43.642Z `cargo test --manifest-path src-tauri/Cargo.toml preserves_only_non_client_deactivation`: 通过：Windows WM_NCACTIVATE(FALSE) 判定测试 1/1 通过，Rust 桌面壳编译成功。

## Completed

- 2026-08-12T10:30:40.462Z Windows 主窗口通过 SetWindowSubclass 处理 WM_NCACTIVATE(FALSE)，失焦后保持材质活动视觉且不抢焦点；用户实机验收通过。
