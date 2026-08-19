# Task: 后端结构化日志与设置页日志查看器

## Background

远程用户使用过程中出错（例：「未找到可由 CodeM 启动的 OpenCode CLI」）时无法定位：
当前 CodeM 只有桌面壳 `desktop.log` 的十几行生命周期事件，axum 后端（渠道、Agent 探测/启动、聊天、MCP）没有任何文件日志，错误经 HTTP 返回后即丢失。
用户需要一个能在设置页直接查看日志、并一键导出诊断包来自查或报障的入口。

## Objective

为后端关键路径（Agent CLI 探测/启动、渠道测试、HTTP 错误、后端启停）增加结构化滚动文件日志，并在设置页提供日志查看与诊断包导出，敏感信息脱敏。

## Scope

In scope:

- 后端：新增 `app_logging` 模块（tracing + 按天滚动文件，`{app_data_dir}/logs/`，保留 7 天，自定义可解析行格式）
- 后端：日志初始化挂在 `run_with_config`（覆盖桌面内嵌后端、Agent Mux Runtime、独立 dev 后端三种形态）
- 后端：关键路径埋点——后端启停、Agent CLI 探测失败原因（env 覆盖、PATH 查找结果、候选数）、渠道测试结果、Agent 启动失败、HTTP 4xx/5xx 与慢请求（≥2s）审计中间件
- 后端：日志 API——`GET /api/logs/files`、`GET /api/logs/tail`（文件名校验防目录穿越、级别/关键词过滤、行数上限）、`POST /api/logs/export`（zip 诊断包：日志 + info.json 版本/环境信息，不含任何密钥）
- 前端：设置页新增「日志与诊断」节——文件列表、级别过滤、搜索、手动/自动刷新、尾部 N 行查看（渲染行数上限保护 DOM）、导出诊断包
- 脱敏：日志不写入 API Key/Token/消息正文；提供 `redact_secrets` 兜底工具函数
- 测试：`app_logging` 纯函数单测（列文件/读取/过滤/防穿越/脱敏/诊断包）；前端日志过滤 helper 单测

Out of scope:

- 不做 OpenAI Responses/Gemini 协议网关（已另行提案，暂缓）
- 不做日志远程上报 / WebDAV 同步
- 不做 desktop.log 迁移（保持现状，两份日志并存，查看器只读后端 logs 目录）
- 不做按 channel 的结构化用量分析（usage 另有模块）
- 不做前端虚拟滚动（用渲染行数上限替代，后续有需要再升级）

## Impact

- backend：`src-tauri/src/app_logging.rs`（新增）、`backend.rs`（初始化+路由+探测埋点+中间件）、`agent_channels.rs`（渠道测试埋点）、`agent_run.rs`（启动失败埋点，视现有错误路径工作量最小化）、`lib.rs`、`Cargo.toml`
- frontend：`src/types.ts`（SettingsSection 增加 `logs`）、`src/components/settings/SettingsSidebar.tsx`、`SettingsView.tsx`、`LogsSettings.tsx`（新增）、`src/lib/log-viewer.ts`（新增 helper）、`src/styles.css`（查看器样式，复用现有变量）
- 风险：tracing 全局 subscriber 只能初始化一次，需 Once 保护；日志 IO 失败不能影响主流程（全部 best-effort）

## Acceptance Criteria

- [ ] 后端启动后 `{app_data_dir}/logs/` 生成当天日志文件，行格式可解析（时间/级别/模块/消息）
- [ ] Agent CLI 探测失败时日志包含 provider、失败阶段与原因（不再只有一句「未找到」）
- [ ] 渠道测试结果（成功/失败+错误摘要）写入日志，不含 API Key
- [ ] HTTP 4xx/5xx 与慢请求被审计中间件记录（方法+路径+状态+耗时，无请求体）
- [ ] `GET /api/logs/files` 返回文件清单；`GET /api/logs/tail` 支持级别/关键词过滤且拒绝 `../` 等非法文件名
- [ ] `POST /api/logs/export` 生成 zip（日志+info.json），返回路径并可尝试在文件管理器中显示
- [ ] 设置页出现「日志与诊断」节，可切换文件、过滤、刷新、导出；渲染行数有上限
- [ ] `cargo fmt --check`、`cargo test`、`npm run typecheck`、`node --import tsx --test` 全部通过
- [ ] 重启桌面开发模式后端到端手工验证通过

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- `node --import tsx --test src/lib/log-viewer.test.ts`
- 手工：重启 `npm run desktop:dev` 后访问设置-日志与诊断，确认文件列表/过滤/导出可用

## Implementation Record

- 2026-08-19T02:58:09.465Z 实现摘要：新增 src-tauri/src/app_logging.rs（tracing 按天滚动 + 自定义行格式 + 文件名安全校验 + 脱敏 + 诊断包 zip）；run_with_config 初始化日志并合并 /api/logs/* 路由；audit_http 中间件记录 4xx/5xx 与 >=2s 慢请求；OpenCode CLI 解析分步埋点；渠道测试结果埋点；前端新增设置节「日志与诊断」（LogsSettings.tsx + StandardSelect/SegmentedControl + 自动刷新 + 1000 行渲染上限）。修复两处实现 bug：自定义格式缺换行、parse_log_level 误读时间戳括号。注意点：codem-agent-mux 二进制只在 desktop:dev 启动时构建，tauri 热重建不覆盖，改 lib 后需完整重启
- 2026-08-19T02:32:34.235Z 完成任务文件：范围锁定为 tracing 滚动文件日志 + app_logging 模块 + 三个日志 API + 设置页日志与诊断节；初始化点选在 run_with_config 覆盖三种运行形态

- 2026-08-19T02:28:10.154Z Task created by Trellis automation.
- 2026-08-19 方案确认：用户在 A（结构化日志+内嵌查看器）、B（仅打开目录）、C（仅诊断包）中选定 A；第一期界面收敛为列表+查看+过滤+导出，自动刷新与高级过滤后补。

## Verification Results
- 2026-08-19T02:57:59.770Z `端到端（desktop:dev 重启后）`: GET /api/logs/files 返回当日日志；tail 级别/关键词过滤正常；渠道测试埋点落盘（channel=DeepSeek 行）；慢请求审计可见；POST /api/logs/export 生成 zip 并在资源管理器定位成功

- 2026-08-19T02:57:59.301Z `node --import tsx --test src/lib/log-viewer.test.ts + npm run typecheck + cargo fmt --check`: 前端 4 测试通过、typecheck 通过、fmt 通过
- 2026-08-19T02:57:58.842Z `cargo test --manifest-path src-tauri/Cargo.toml`: 全部通过：568 lib + 14 + 21，0 失败；app_logging 5 个单测覆盖文件名校验/级别解析/脱敏/尾部过滤/诊断包

## Completion Summary
- 2026-08-19T02:58:09.887Z 后端结构化日志与设置页日志查看器完成：三种运行形态（桌面内嵌/Mux Runtime/独立后端）统一落盘 {app_data_dir}/logs/backend.log.YYYY-MM-DD；设置页可查看/过滤/搜索/自动刷新并导出诊断包；Agent CLI 探测、渠道测试、HTTP 审计、启停事件均埋点且不含密钥。全部测试通过，端到端已验证

## Follow-ups
