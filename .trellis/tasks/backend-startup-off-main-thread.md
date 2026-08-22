# Task: 后端启动目标解析移出主线程

## Background

Tauri setup 回调在主线程同步执行 `resolve_backend_startup_target`。当 Agent Mux Runtime discovery 是 stale 时（日志显示几乎每次冷启动都会出现），需先同步等待旧 runtime 关闭确认（实测约 700-1100ms），再拉起 `codem-agent-mux.exe ensure` 并轮询（上限 15s）。期间 Tauri 事件循环尚未启动，窗口显示、WebView 页面加载回调全部被推迟。

## Objective

把 Tauri setup 中同步执行的 resolve_backend_startup_target 移到后台线程，避免 stale Agent Mux Runtime 路径阻塞主线程约 1 秒（最坏 15 秒），并保证 get_backend_connection 命令能等到解析结果而不是拿到默认端口

## Scope

In scope:

- `src-tauri/src/main.rs`：setup 内后端目标解析改为后台线程执行
- `BackendPortState` 改用 `tokio::sync::watch` 承载解析结果，`get_backend_base_url` / `get_backend_connection` 改为 async 命令等待解析完成后返回
- 解析失败时回退默认端口 3001 并解除前端等待，保持旧行为
- 新增 watch 同步语义单元测试

Out of scope:

- 首帧空白修复被 `focus_main_window` 架空的问题（另行任务）
- stale Agent Mux Runtime "did not confirm shutdown" 本身的修复
- 前端 main.tsx 模块瀑布与首屏包体积优化

## Impact

- 桌面启动主线程不再被后端目标解析阻塞，窗口与 WebView 可提前约 1 秒（stale 路径）开始启动
- 前端 `initializeApiFetchBridge` 的 invoke 语义不变：在解析完成前会等待，完成后立即返回

## Acceptance Criteria

- [x] setup 不再同步执行后端目标解析
- [x] `get_backend_connection` / `get_backend_base_url` 在解析完成前等待、完成后返回正确端口与 token
- [x] 解析失败时前端命令解除等待并回退默认端口
- [x] 单元测试覆盖"已解析立即返回"与"未解析阻塞直到发布"两种路径
- [x] cargo check / cargo test 通过，桌面 dev 壳重启后后端解析与前端连接正常

## Verification Commands

- `cargo check --manifest-path src-tauri/Cargo.toml --bin codem`
- `cargo test --manifest-path src-tauri/Cargo.toml --bin codem`

## Implementation Record
- 2026-08-21T13:25:09.699Z 实现：BackendPortState 改用 tokio::sync::watch 承载 (port, token) 解析结果并持有一个 receiver 防止通道 closed；get_backend_base_url / get_backend_connection 改为 async 命令，通过 wait_for_backend_connection 等待解析发布；setup 中 resolve_backend_startup_target + start_backend_startup_check 移入后台线程，解析失败时回退 DEFAULT_BACKEND_PORT=3001 保持旧行为；新增两个 tokio 测试覆盖立即返回与阻塞到发布两条路径

- 2026-08-21T13:19:21.799Z Task created by Trellis automation.

## Verification Results
- 2026-08-21T13:25:19.604Z `desktop dev 壳重启实测`: tauri dev 检测到 main.rs 变更后自动重编译并重启（4.5s）；新实例 21:21 启动，dev 日志（com.mnl.codem.dev/logs/desktop.log）显示 stale Agent Mux 关闭确认 710ms 与 812ms 两次解析均在后台完成并 selected backend port + check completed；解析出的端口 54007 /api/runtime/identity 返回健康；窗口进程正常

- 2026-08-21T13:25:10.515Z `cargo test --manifest-path src-tauri/Cargo.toml --bin codem`: 16 个测试全部通过，含新增 backend_connection_wait_returns_already_resolved_value 与 backend_connection_wait_blocks_until_resolution_publishes
- 2026-08-21T13:25:10.117Z `cargo check --manifest-path src-tauri/Cargo.toml --bin codem`: 通过，仅既有 dead_code 警告（should_apply_window_material / clear_vibrancy_layers）

## Completion Summary
- 2026-08-21T13:25:20.001Z 后端启动目标解析已移出 Tauri 主线程：setup 仅负责窗口状态恢复与材质设置并 spawn 解析线程；BackendPortState 用 tokio watch 发布 (port, token)，两个后端连接命令改为 async 等待，解析失败回退默认端口 3001；cargo check/test 全过（16 测试），dev 壳实测 stale 路径约 700-800ms 不再阻塞窗口与 WebView 启动

## Follow-ups

- 待补充。
