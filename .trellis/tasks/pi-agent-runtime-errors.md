# Task: 修复 Pi 渠道鉴权与空响应错误展示

## Background

Pi Agent 使用自定义 MiniMax Anthropic 渠道运行时，界面将失败轮次显示为空白助手消息和 `0 tokens`。Pi session 记录表明请求实际返回 401：生成的 `models.json` 把环境变量名写成普通字符串，Pi 0.82.1 因而把它当作字面 API key；同时 CodeM 只读取 `message_end.stopReason`，没有将 `errorMessage` 转换为运行错误。

## Objective

正确传递自定义渠道密钥，并将 Pi message_end 错误展示为运行错误

## Scope

In scope:

- Pi 自定义渠道 `models.json` 使用 Pi 支持的环境变量插值格式，并继续只通过进程环境传递密钥。
- Pi RPC `message_end` 明确包含错误时，将错误安全地转换为本轮 `error` 终态。
- 覆盖配置生成、正常结束和错误结束的 Rust 回归测试。

Out of scope:

- 改动现有前端 `done/error` 事件协议或空消息渲染逻辑。
- 将真实 API key 写入配置、日志、测试输出或任务记录。
- 调整其他 Agent 的渠道配置和错误处理。
- 为特定服务商硬编码额外请求头，除非 Pi 官方 provider 实现证明必须这样做。

## Impact

- `src-tauri/src/agent_channels.rs`
- `src-tauri/src/pi_rpc.rs`
- `src-tauri/src/agent_run.rs`
- Pi 自定义渠道的运行时配置、热会话轮次结束语义和错误展示。

## Acceptance Criteria

- [x] Pi `models.json` 的 `apiKey` 使用 `$ENV_VAR` 引用，且配置文件不包含真实密钥。
- [x] 正常 `message_end` 仍保留 `stopReason` 并正常结束。
- [x] `stopReason=error` 且存在 `errorMessage` 时，本轮返回可见且已脱敏的运行错误，不再显示为成功空响应。
- [x] 现有 Pi 热会话、模型选择和事件映射测试保持通过。
- [x] 桌面开发模式重启后，MiniMax 渠道能产生正常助手文本；错误密钥能显示鉴权错误。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml pi_custom_channel_uses_isolated_secret_free_runtime_config`
- `cargo test --manifest-path src-tauri/Cargo.toml pi_`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-session-preferences.test.ts`
- `npm run build`
- `Invoke-RestMethod http://127.0.0.1:3001/api/health`

## Implementation Record

- 2026-07-26T10:28:45.673Z 用户在重启后的桌面版使用 Pi + MiniMax-M3 完成真实运行，界面显示工具调用、助手正文和 token 用量。复核实际 models.json 仅保存 $CODEM_PI_CHANNEL_* 环境引用，未写入真实密钥；错误处理仅响应 Pi 官方 stopReason=error 与 errorMessage。
- 2026-07-26T10:17:35.454Z 确认 Pi 0.82.1 的 apiKey 环境变量必须使用 $ENV_VAR；Anthropic provider 会通过 SDK 生成 x-api-key，无需服务商专用请求头。已按 TDD 修正配置生成并将 message_end 错误转换为脱敏、非致命的运行错误。

- 2026-07-26T10:09:11.947Z Task created by Trellis automation.

## Verification Results
- 2026-07-26T10:28:47.724Z `cargo test --manifest-path src-tauri/Cargo.toml pi_`: 复核通过：37 passed, 0 failed

- 2026-07-26T10:28:46.660Z `用户桌面实测 Pi + MiniMax-M3`: 正常返回助手正文与工具调用，界面显示 377 tokens；本地 Pi session 最后一条 stopReason=stop、errorMessage 为空、正文 322 字符并记录真实 usage
- 2026-07-26T10:24:14.423Z `Invoke-RestMethod http://127.0.0.1:3001/api/health`: available=true；桌面开发服务已重启在 3001/5173

- 2026-07-26T10:24:13.386Z `npm run build`: Vite 生产构建通过；仅有现有 chunk size/dynamic import 警告
- 2026-07-26T10:24:12.358Z `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-session-preferences.test.ts`: 20 passed, 0 failed

- 2026-07-26T10:24:11.359Z `npm run typecheck`: 通过
- 2026-07-26T10:24:10.331Z `cargo test --manifest-path src-tauri/Cargo.toml`: 222 passed, 0 failed, 1 ignored；桌面二进制测试 13 passed

- 2026-07-26T10:24:09.280Z `cargo test --manifest-path src-tauri/Cargo.toml pi_`: 37 passed, 0 failed
- 2026-07-26T10:24:08.168Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过

## Completion Summary
- 2026-07-26T10:28:48.727Z 修复 Pi 自定义渠道环境密钥引用和 message_end 错误透传；真实 MiniMax 会话、错误回归、热会话与密钥不落盘均完成验收。

## Follow-ups

- 无。
