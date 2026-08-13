# Task: 工作流 SQLite 持久化

## Background

工作流原型已经具备编辑、保存、运行与运行记录界面，但用户工作流和运行记录仍保存在浏览器 localStorage，并在空数据时注入默认 Mock。需要迁移到开发版后端 SQLite，使刷新和桌面重启后都从真实持久化恢复。

## Objective

将工作流定义与运行记录接入 Agent Mux 使用的 `codem.sqlite`，移除默认 Mock 用户数据，同时保留内置可选模板。

## Scope

In scope:

- 新增工作流定义和运行记录的 SQLite 表与本地 REST CRUD。
- 前端从后端加载、保存、复制、删除和更新工作流及运行记录。
- 一次性迁移 localStorage 中非默认 Mock 的旧用户数据，迁移完成后删除旧键。
- API 失败以真实错误反馈给用户。
- 将“Mock 数据”“模拟运行”文案改为真实持久化和“预演流程”语义。

Out of scope:

- 不改变工作流图文档结构或运行调度算法。
- 不新增重型编排框架、同步服务或云端存储。
- 不迁移默认 Mock 工作流和默认 Mock 运行记录。
- 不构建、不修改安装版。

## Impact

- `src-tauri/src/agent_mux.rs`
- `src/lib/agent-mux-api.ts`
- `src/components/WorkflowPrototype.tsx`
- 工作流相关测试与样式文案

## Acceptance Criteria

- [x] 新安装/空数据库不出现默认 Mock 工作流和运行记录。
- [x] 新建、编辑、复制、删除工作流后刷新可恢复一致状态。
- [x] 运行记录创建和状态更新后刷新可恢复一致状态。
- [x] 旧 localStorage 用户数据只迁移一次，默认 Mock 数据不会入库。
- [x] 内置模板仍可由用户主动选择加载。
- [x] 持久化失败有可见错误，不用成功文案掩盖失败。

## Verification Commands

- `node --import tsx --test src/lib/workflow-prototype.test.ts`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `git diff --check`

## Implementation Record
- 2026-08-12T11:07:10.782Z 已补充 SQLite 持久化任务边界；新增 Agent Mux 工作流定义和运行记录 JSON 文档 CRUD，并移除前端默认 Mock 回退。

- 2026-08-12T11:06:59.810Z 已补充 SQLite 持久化任务边界；新增 Agent Mux 工作流定义和运行记录 JSON 文档 CRUD，并移除前端默认 Mock 回退。
- 2026-08-12T11:06:37.862Z 已补充 SQLite 持久化任务边界；新增 Agent Mux 工作流定义和运行记录 JSON 文档 CRUD，并移除前端默认 Mock 回退。

- 2026-08-12T10:59:18.889Z Task created by Trellis automation.

## Verification Results

- 2026-08-12T11:11:08.439Z `开发 Agent Mux HTTP CRUD smoke`: 动态开发端口 61115：工作流列表初始 0，创建、更新、删除闭环成功且测试记录已清理
- 2026-08-12T11:11:08.436Z `node --import tsx --test src/lib/workflow-prototype.test.ts`: 8/8 通过

- 2026-08-12T11:11:08.436Z `npm run typecheck && npm run build`: TypeScript 检查与 Vite 生产构建通过
- 2026-08-12T11:11:08.429Z `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && cargo test --manifest-path src-tauri/Cargo.toml agent_mux`: 格式检查通过，Agent Mux 定向测试 22/22 通过

## Completion Summary
- 2026-08-12T11:11:15.216Z 工作流定义与运行记录已迁移至开发版 Agent Mux SQLite；内置模板保留，默认 Mock 用户数据已移除，旧 localStorage 非默认数据支持一次性迁移；完成 CRUD、类型检查、构建、Rust 定向测试与开发接口闭环验证。

## Follow-ups

- 暂不提供工作流导入导出、云同步和复杂版本管理；在真实需求出现后再设计。
