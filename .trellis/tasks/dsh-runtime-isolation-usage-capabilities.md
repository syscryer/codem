# Task: 隔离 DSH Runtime 并按能力展示 Usage

## Background

DSH 专属预设和工具模式此前进入所有 Agent 的 Runtime 配置比较，修改后会误判其他 Agent 热会话不可复用。Usage UI 同时固定展示 DSH 分项，无法反映不同 Agent 实际提供的指标。

## Objective

确保 DSH 设置不影响其他 Agent 热会话，并让统一 Usage 模板按各 Agent 实际提供的数据动态展示

## Scope

In scope:

- 将 DSH Runtime 参数限制在 DSH Driver。
- 非 DSH 请求不发送、不解析 DSH 专属参数。
- 修正共享 Usage 快照的零值合并语义。
- 统一 Usage 模板按字段可用性动态展示。

Out of scope:

- 修改各 Agent 上游实际提供的 Usage 数据。
- 重构现有 Agent Runtime 生命周期。

## Impact

- 后端 Agent 热会话复用判断。
- 前端 Agent 请求体、Usage 聚合与上下文弹层。

## Acceptance Criteria

- [x] 修改 DSH 设置不重建非 DSH 热会话。
- [x] DSH 预设或工具模式变化仍会重建 DSH 热会话。
- [x] Usage 数值为 0 时仍能表达该指标可用。
- [x] UI 仅展示当前 Agent 实际提供的 Usage 项目。
- [x] 前后端相关测试和构建通过，桌面开发版已重启。

## Verification Commands

- `node --import tsx --test src/lib/conversation.test.ts src/lib/composer-context-usage.test.ts`
- `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`
- `cargo test -q --manifest-path src-tauri/Cargo.toml hot_runtime_reuse -- --nocapture`
- `npm.cmd run build`
- `cargo check -q --manifest-path src-tauri/Cargo.toml`
- `git diff --check`

## Implementation Record
- 2026-08-14T03:28:36.425Z 已将 DSH 专属预设和工具模式隔离到 DSH Runtime；非 DSH 请求不再发送或解析这些字段。Usage 继续使用统一快照类型，并由字段可用性动态决定展示项目。

- 2026-08-14T02:56:14.302Z Task created by Trellis automation.

## Verification Results

- 2026-08-14T03:28:57.870Z `desktop:dev restart`: 已重启，src-tauri/target/debug/codem.exe 为本次重新生成并运行，http://127.0.0.1:5173/ 返回 200。
- 2026-08-14T03:28:57.606Z `git diff --check`: 通过；仅有工作区既有 CRLF 转换提示。

- 2026-08-14T03:28:57.334Z `cargo fmt --check --manifest-path src-tauri/Cargo.toml`: 通过。
- 2026-08-14T03:28:57.069Z `cargo check -q --manifest-path src-tauri/Cargo.toml`: 通过；仅有仓库既有 dead_code 告警。

- 2026-08-14T03:28:56.800Z `npm.cmd run build`: 通过，TypeScript 和 Vite 生产构建成功；仅有既有分包体积提示。
- 2026-08-14T03:28:56.534Z `cargo test -q --manifest-path src-tauri/Cargo.toml dsh_ -- --nocapture`: 通过，10 个 DSH 相关用例全部成功。

- 2026-08-14T03:28:56.258Z `cargo test -q --manifest-path src-tauri/Cargo.toml hot_runtime_reuse -- --nocapture`: 通过，3 个热会话复用用例全部成功。
- 2026-08-14T03:28:55.995Z `node --import tsx --test src/lib/conversation.test.ts src/lib/composer-context-usage.test.ts`: 通过，43 个用例全部成功。

## Completion Summary
- 2026-08-14T03:29:18.123Z 完成 DSH Runtime 配置隔离和通用 Usage 能力展示：其他 Agent 热会话不再受 DSH 设置影响，Usage 按实际返回字段动态显示；相关测试、构建、格式检查通过，桌面开发版已重启。

## Follow-ups

- 各 Agent 可继续补充其自身能稳定提供的 Usage 字段，无需增加 Provider 专属 UI。
