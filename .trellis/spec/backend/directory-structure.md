# Backend Directory Structure

## 当前推荐结构

```text
src-tauri/src/
  backend.rs
  agent_run.rs
  agent_runtime.rs
  acp.rs
  codex_app_server.rs
  ordinary_chat/
  main.rs
  lib.rs
  bin/codem-backend.rs
```

## 放置规则

- `backend.rs`
  - Axum bootstrap、路由注册、Claude bridge、workspace/SQLite 与通用系统 API
- `agent_run.rs` / `agent_runtime.rs`
  - 多 Agent 运行状态机、事件流、审批、暂停与恢复
- `acp.rs` / `codex_app_server.rs`
  - 外部 Agent 协议适配，不把协议细节散落到 route handler
- `ordinary_chat/`
  - 普通聊天独立领域，按 provider、runtime、storage、MCP、Skills、知识库拆分
- `main.rs`
  - Tauri 桌面生命周期、窗口和 backend 启动
- `bin/codem-backend.rs`
  - 独立开发后端二进制入口

## 推荐演进方向

- 新增协议或复杂状态机时优先拆独立 Rust module，不继续扩大 `backend.rs`。
- route handler 负责参数校验、调用领域逻辑和响应映射，不直接堆长流程。
- 跨 Agent 的共享事件和类型应集中维护，普通聊天与 Agent 运行状态保持独立。
- SQLite schema、迁移和读写逻辑应放在对应领域边界内，并有行为测试覆盖。
