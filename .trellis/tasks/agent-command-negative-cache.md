# Task: Agent 命令解析通用负缓存

## Background

DSH 接入 review(GLM 与 Codex 双方结论一致)发现:`resolve_agent_command` 只缓存探测成功的命令,未安装的 provider 每次 `agent_providers` 等共享端点请求都会重新 spawn PowerShell 探测(`resolve_dsh_command` 超时 3 秒),拖慢所有用户的 Agent 列表加载。这是 grok/codex/gemini 等既有 provider 共同的架构问题,DSH 只是第 8 次叠加。

## Objective

为 resolve_agent_command 增加短 TTL 负缓存,避免未安装 provider 在 agent_providers 等共享端点重复探测

## Scope

In scope:

- `CachedAgentCommand.command` 改为 `Option<String>`,负结果同样入缓存。
- 正向缓存 TTL 保持 5 分钟,负缓存 TTL 60 秒。
- `refresh=true` 路径(安装/更新成功后、诊断)保持绕过缓存强刷,不受负缓存影响。
- 修复 DSH 任务遗漏更新的 `backend.rs` 旧断言(`normalize_agent_runtime_settings` 输出新增 dsh 三键)。

Out of scope:

- 不改 hermes 自身的命令解析缓存。
- 不调整探测实现本身(PowerShell/忙等),只加缓存层。

## Impact

- backend:`src-tauri/src/agent_run.rs`(缓存结构、读写、resolve 流程、测试)、`src-tauri/src/backend.rs`(仅测试断言)。

## Acceptance Criteria

- [x] 未安装 provider 在负缓存 TTL 内重复调用 `resolve_command(_, false)` 不再触发探测。
- [x] 负缓存 60 秒后过期,重新探测。
- [x] `resolve_command(_, true)` 仍强制重探,安装完成后立即可见。
- [x] 正向缓存 TTL 语义不变。
- [x] 完整后端测试通过(除环境相关既有失败)。

## Verification Commands

- `cargo test --manifest-path src-tauri/Cargo.toml agent_command`
- `cargo test --manifest-path src-tauri/Cargo.toml`

## Implementation Record
- 2026-08-14T07:34:18.365Z 实现通用负缓存:CachedAgentCommand.command 改为 Option<String>,正向 TTL 5 分钟/负向 60 秒,refresh=true 仍强刷;新增 agent_command_negative_cache_expires_quickly 测试;顺带修复 DSH 遗漏的 normalize_agent_runtime_settings 旧断言

- 2026-08-14T07:23:27.833Z Task created by Trellis automation.
- 2026-08-14 `CachedAgentCommand.command` 改为 `Option<String>`;`read_cached_agent_command` 返回 `Option<Option<String>>`,按条目类型选 TTL(正向 5 分钟/负向 60 秒);`resolve_agent_command` 对未命中的解析结果(含 None)统一入缓存;refresh 路径不变。
- 2026-08-14 更新 `agent_command_cache_reuses_fresh_entries_and_expires_old_ones`、`agent_command_resolution_reuses_cache_until_forced_refresh`,新增 `agent_command_negative_cache_expires_quickly`,覆盖负缓存命中、过期、强刷绕过。
- 2026-08-14 修复 DSH 遗漏的 `agent_runtime_settings_default_to_claude_and_preserve_supported_values` 断言(补 dshProfile/dshAgentPreset/dshToolsMode 默认键),该失败在本次改动前即存在。

## Verification Results
- 2026-08-14T07:34:19.657Z `桌面开发壳重启 + /api/runtime/identity`: codem.exe 15:30 重新构建并启动,identity 返回 200(backend rust, protocolVersion 2),负缓存已随新二进制生效

- 2026-08-14T07:34:19.219Z `cargo test --manifest-path src-tauri/Cargo.toml`: 494 通过/1 失败/1 忽略;唯一失败为 ordinary_chat 环境相关既有失败(本机代理拦截已关闭端口返回 502),与本次改动无关
- 2026-08-14T07:34:18.797Z `cargo test --manifest-path src-tauri/Cargo.toml agent_command`: 3/3 通过:负缓存命中不重探、60 秒过期、强刷绕过、正向 TTL 不变

## Completion Summary
- 2026-08-14T07:34:31.371Z Agent 命令解析通用负缓存完成:未安装 provider 60 秒内不再重复探测,安装/诊断强刷路径不受影响;修复 DSH 遗漏的后端测试断言;定向测试 3/3、全量 494 通过(1 个环境相关既有失败);桌面开发壳已重启生效

## Follow-ups

- `ordinary_chat::provider::tests::request_errors_include_the_original_cause_without_url_secrets` 在本机因系统级代理/TUN 拦截已关闭端口返回 502 而失败,与 DSH 和本次改动无关,属环境问题,待环境恢复后复跑确认。
