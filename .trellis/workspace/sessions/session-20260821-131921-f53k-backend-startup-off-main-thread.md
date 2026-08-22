# Session Record: 后端启动目标解析移出主线程

- Session: session-20260821-131921-f53k
- Started: 2026-08-21T13:19:21.797Z
- Task: .trellis/tasks/backend-startup-off-main-thread.md

## Notes
- 2026-08-21T13:25:09.699Z 实现：BackendPortState 改用 tokio::sync::watch 承载 (port, token) 解析结果并持有一个 receiver 防止通道 closed；get_backend_base_url / get_backend_connection 改为 async 命令，通过 wait_for_backend_connection 等待解析发布；setup 中 resolve_backend_startup_target + start_backend_startup_check 移入后台线程，解析失败时回退 DEFAULT_BACKEND_PORT=3001 保持旧行为；新增两个 tokio 测试覆盖立即返回与阻塞到发布两条路径

- 2026-08-21T13:19:21.801Z Session started.

## Verification
- 2026-08-21T13:25:19.604Z `desktop dev 壳重启实测`: tauri dev 检测到 main.rs 变更后自动重编译并重启（4.5s）；新实例 21:21 启动，dev 日志（com.mnl.codem.dev/logs/desktop.log）显示 stale Agent Mux 关闭确认 710ms 与 812ms 两次解析均在后台完成并 selected backend port + check completed；解析出的端口 54007 /api/runtime/identity 返回健康；窗口进程正常

- 2026-08-21T13:25:10.515Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem`: 16 个测试全部通过，含新增 backend_connection_wait_returns_already_resolved_value 与 backend_connection_wait_blocks_until_resolution_publishes
- 2026-08-21T13:25:10.117Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem`: 通过，仅既有 dead_code 警告（should_apply_window_material / clear_vibrancy_layers）

## Completed

- 2026-08-21T13:25:20.001Z 后端启动目标解析已移出 Tauri 主线程：setup 仅负责窗口状态恢复与材质设置并 spawn 解析线程；BackendPortState 用 tokio watch 发布 (port, token)，两个后端连接命令改为 async 等待，解析失败回退默认端口 3001；cargo check/test 全过（16 测试），dev 壳实测 stale 路径约 700-800ms 不再阻塞窗口与 WebView 启动
