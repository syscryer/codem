# Task: 修复外部 CCSwitch 渠道同步

## Background

CCSwitch 可以在 CodeM 运行期间从外部切换 Agent 渠道。系统渠道应继续跟随外部配置，但 CodeM 自定义渠道必须保持自己的地址、模型和密钥，不应被用户的 `~/.claude/settings.json` 覆盖。

## Objective

保证 CodeM 自定义渠道不受 CCSwitch 外部切换影响，并让系统渠道在外部切换后刷新为当前供应商及图标。

## Scope

In scope:

- 系统渠道在窗口重新获得焦点或恢复可见时重新读取当前 CCSwitch/Agent 配置。
- 自定义 Claude 渠道通过独立的 CLI settings 注入地址、模型和 API key helper，隔离外部 settings 的认证配置。
- 为上述刷新和隔离行为补充回归测试。

Out of scope:

- 修改 CCSwitch 的配置文件或数据库。
- 改变系统渠道的既有跟随语义。
- 重构其他 Agent 的渠道运行时。

## Impact

- 前端渠道 bootstrap 会在窗口重新获得焦点/可见时异步刷新，并以 2 秒节流避免重复请求。
- 自定义 Claude 进程仍继承渠道环境变量，但通过 `--settings` 清空外部认证变量并从临时进程环境读取 CodeM 密钥；密钥不进入命令行或持久化 settings JSON。

## Acceptance Criteria

- [x] 外部 CCSwitch 切换后，CodeM 回到前台时系统渠道名称、地址、模型和图标刷新。
- [x] 自定义 Claude 渠道使用自身 API 地址、模型和密钥，不会混用 CCSwitch 当前渠道的 token。
- [x] 自定义渠道运行参数不在命令行或 settings JSON 中暴露真实密钥。
- [x] 刷新请求支持取消和节流，不会让旧请求覆盖新状态。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/hooks/useAgentChannels.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml custom_claude_channel_args_pin_channel_settings_without_exposing_secrets`
- `git diff --check`

## Implementation Record

- 2026-07-18T15:48:29.437Z 完成外部 CCSwitch 渠道同步修复：系统渠道在窗口重新获得焦点或恢复可见时刷新 bootstrap；自定义 Claude 渠道通过 --settings 固定 CodeM 地址/模型并用 apiKeyHelper 读取进程密钥，隔离 CCSwitch settings.json 的认证变量。
- 2026-07-18T15:34:18.552Z 定位完成：系统渠道 bootstrap 后端实时读取 CCSwitch，但前端仅首次挂载；自定义 Claude 渠道需要隔离用户 settings.json 的外部渠道地址并明确默认模型。计划分别修复前端焦点刷新和 Claude 启动参数隔离。

- 2026-07-18T15:26:05.834Z Task created by Trellis automation.

## Verification Results
- 2026-07-18T15:49:45.324Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：171 passed，1 ignored，0 failed；桌面二进制 13 passed

- 2026-07-18T15:48:57.388Z `git diff --check`: 通过
- 2026-07-18T15:48:51.453Z `cargo test --manifest-path src-tauri/Cargo.toml custom_claude_channel_args_pin_channel_settings_without_exposing_secrets`: 通过

- 2026-07-18T15:48:42.972Z `node --import tsx --test src/hooks/useAgentChannels.test.ts`: 通过，1/1
- 2026-07-18T15:48:35.518Z `npm run typecheck`: 通过

## Completion Summary
- 2026-07-18T15:50:01.247Z 已完成外部 CCSwitch 渠道同步修复：系统渠道回到前台后自动刷新当前供应商和图标；自定义 Claude 渠道隔离 CCSwitch 认证配置并固定自身地址/模型/密钥。类型检查、前端刷新测试、完整 Rust 测试和 diff 检查均通过。

## Follow-ups

- 完整前端测试中仍有两个与本任务无关的既有失败：桌面 macOS private API feature 断言和外部 URL opener 正则断言。
