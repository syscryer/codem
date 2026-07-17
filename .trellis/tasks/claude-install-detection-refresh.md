# Task: 修复 Claude 安装后检测闪断

## Background

Windows 桌面进程只会继承 CodeM 启动时的 PATH。一键安装 Claude 后，安装器可能把 CLI 写入 `~/.local/bin` 或 npm 用户级全局目录并更新用户 PATH，但当前 CodeM 进程无法立即看到新 PATH。设置页会短暂使用安装结果显示可用，随后 Provider Registry 再次调用仅依赖 `Get-Command claude` 的探测并覆盖为不可用，导致聊天入口无法选择 Claude。

## Objective

安装或更新 Claude 后，无需重启 CodeM 即可稳定发现 CLI，并保持设置与聊天可用状态一致

## Scope

In scope:

- 保留 PATH 中 Claude 命令的现有优先级，并在未命中时检查官方原生安装目录与 Windows npm 用户级全局目录。
- 所有候选路径必须是可直接启动的文件，并通过 `--version` 验证。
- Claude 安装或更新完成后同步刷新 Claude 专用版本信息、设置诊断与全局 Provider Registry。
- 防止安装前发出的旧 Claude 探测结果在安装完成后覆盖新状态。
- 补充 Rust 路径发现测试与前端安装后刷新回归测试。

Out of scope:

- 不修改系统或用户 PATH。
- 不扫描任意磁盘目录，不接管 Claude 凭据、认证或配置。
- 不改变 Agent 运行协议、线程持久化、模型与权限行为。
- 不改变其他 Agent 和普通聊天的运行机制。

## Impact

- Backend: `src-tauri/src/backend.rs` Claude CLI 命令发现与生命周期完成后的真实诊断。
- Frontend: `src/components/settings/AgentProviderSettings.tsx` Claude 安装后异步状态刷新。
- Tests: Rust Claude 路径测试与 Agent 设置管理前端测试。

## Acceptance Criteria

- [x] 当前进程 PATH 未包含新目录时，仍能发现 `~/.local/bin/claude.exe`。
- [x] Windows npm 一键安装后，仍能发现 `%APPDATA%/npm/claude.cmd`。
- [x] PATH 中已有 Claude 时继续优先使用 PATH 结果。
- [x] 无效候选不会被标记为已安装或聊天可用。
- [x] 安装完成后 Claude 专用版本信息与 Provider Registry 都会刷新，旧请求不能覆盖新结果。
- [x] 设置页与聊天选择器对 Claude 可用性的判断保持一致。
- [x] 定向测试、类型检查、Rust 测试、格式检查和 Windows 打包通过。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml claude_command`
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-provider-registry.test.ts`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:doctor`
- `npm run package:win`

## Implementation Record

- 2026-07-17T02:09:40.194Z 补强 Windows npm 回归：抽取生产候选验证函数，并用 PATH 外真实 claude.cmd 验证无效原生候选会被跳过、可运行 npm 命令才会被选中。
- 2026-07-17T01:58:35.672Z 确认根因并完成首轮修复：Claude 命令解析在 PATH 未命中时验证官方 ~/.local/bin 与 Windows APPDATA/npm 候选；安装后重新加载对应 Provider 详情，并使用请求代次阻止旧 Claude 版本结果覆盖新状态。

- 2026-07-17T01:54:12.929Z Task created by Trellis automation.

## Verification Results

- 2026-07-17T02:12:56.965Z `npm run package:win`: 通过：最终生成 CodeM 0.1.12 NSIS 13,809,530 bytes（SHA256 9BA1378AC4AA63462A45440287600AB5249A21786D834A1CFD6567EB5716ECEE）与 MSI 18,706,432 bytes（SHA256 B4DD88C3CE3C3DDE960FCFC14F9714D01FED61AB16B200C42A95E16ECD7C55EC）
- 2026-07-17T02:07:09.845Z `npm run package:doctor；npm run package:win`: 通过：Doctor OK；生成 NSIS 13,812,850 bytes 与 MSI 18,710,528 bytes，版本 0.1.12

- 2026-07-17T02:03:18.454Z `npm run typecheck；cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check`: 全部通过，仅有 Windows 工作区既有 LF/CRLF 提示
- 2026-07-17T02:03:17.581Z `隔离 PATH 的真实 Rust API 探测`: 通过：PATH 移除 .local/bin 与 APPDATA/npm 后，health、version-info 与 Provider Registry 均解析 C:\Users\csm\.local\bin\claude.exe；available=true、selectable=true

- 2026-07-17T02:03:16.679Z `node --import tsx --test src/**/*.test.ts`: 通过：前端 509/509
- 2026-07-17T02:03:15.775Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust library 144/144、desktop 9/9，1 个真实 Grok smoke 按设计忽略

## Completion Summary
- 2026-07-17T02:13:09.472Z 修复 Claude 一键安装后因桌面进程 PATH 未刷新而短暂可用又失效的问题：后端验证 PATH、官方本地目录与 Windows npm 候选，前端安装后刷新 Provider 并隔离旧探测请求；前后端全量测试、类型与格式检查、package doctor 及 Windows NSIS/MSI 打包均通过。

## Follow-ups

- 暂无。
