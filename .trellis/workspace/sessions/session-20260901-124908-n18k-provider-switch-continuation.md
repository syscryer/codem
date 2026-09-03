# Session Record: 放开 Provider 切换与会话续接

- Session: session-20260901-124908-n18k
- Started: 2026-09-01T12:49:08.679Z
- Task: .trellis/tasks/provider-switch-continuation.md

## Notes
- 2026-09-02T14:40:41.572Z Hermes 安装 exit-0 缺陷修复：install.ps1 内部失败（git fetch TLS 失败）时退出码仍为 0，CodeM 仅凭退出码判定成功——跳过代理重试、找不到可执行文件后报误导性"未检测到"。新增 lifecycle_output_failed：退出码非 0 或输出含"installation failed"均视为失败，代理重试与失败报错共用该判定（含网络失败无代理时的指引提示）。cargo test 590+16+21 通过。

- 2026-09-02T13:38:26.375Z Hermes 安装二次失败排查与改进：杀软放行后安装依赖全部就绪（uv/Python3.12/Git/Node22/ripgrep/ffmpeg），最终失败于 git fetch GitHub（schannel TLS 握手失败，直连不通且安装进程无代理）。is_agent_lifecycle_network_failure 已命中（fetch failed），但 proxy_retry 为 None（未配置代理）无法自动重试。改进：安装失败且判定网络失败但无可用代理时，错误文案附加"配置网络代理后重试或开代理终端手动安装"指引。cargo lifecycle 测试 11 passed。
- 2026-09-02T12:56:41.495Z Agent 设置页 Hermes 分区新增安装说明（可折叠 details，默认收起）：说明一键安装为官方全家桶安装器（自带 Python/Git/Node/ripgrep/ffmpeg 至 %LOCALAPPDATA%\hermes，无需管理员权限）；拒绝访问(os error 5)多为杀软拦截及放行步骤；可改用官方签名安装器 Hermes-Setup.exe 手动安装；旧损坏安装的清理方式（保留 ~/.hermes 配置）。样式复用主题变量。

- 2026-09-02T01:53:33.659Z Hermes 安装报错排查：复现 POST /api/agents/lifecycle 500，真实错误为 spawn 安装进程被拒（os error 5 拒绝访问），用户确认系杀毒软件拦截——CodeM 侧链路正常。顺手改进：lifecycle Start 错误在 Windows os error 5 时附加杀软拦截提示（describe_agent_lifecycle_start_error），cargo test 590+16+21 通过。
- 2026-09-02T01:20:21.921Z 阶段性提交推送：ce6ddd9 已推送 origin main（Provider 会话内切换续接 + DSH ACP alpha.3 迁移 + DSH Alpha 检测，含 64MB 历史上限、流式上游限制记录、GPT review 竞态修复）。任务手工验收项保持未勾选，继续后续工作。

- 2026-09-01T14:24:24.889Z effort 未持久化排查与两项修复：(1) 实测当前代码 effort 持久化正常（UI 选 High→PATCH→threads.reasoning_effort 与 thread_model_preferences 双写成功），用户遇到的是模型目录未加载窗口期 handleReasoningEffortSelect 本地校验静默拒绝（toast 后 return 不持久化）——已修复为目录未加载时跳过本地校验交后端判断；(2) 发现并修复该会话历史持续 413：axum 默认 2MB 请求体上限，长会话 turns（含 thinking/工具输出）超限导致 PUT /history 永远失败——router 增加 RequestBodyLimitLayer 32MB（tower-http 启用 limit feature），修复后该会话历史将随下次写入自愈。另修复并行 DSH 会话对该 provider 切换测试的半成品改动（SELECT 6 列 4 元组解构、INSERT 漏 updated_at）。
- 2026-09-01T13:59:55.091Z 会话截断问题排查与数据恢复：用户报告 'review一下，当前更改，glm改的'（thread 646a5df4，Codex，session 01a05d35...）历史被截断。定位：messages 表该 turn 的 assistant text item_sort 为 0/9/28/91（90+ items 中仅 4 条 text 落库），最终结论 item 从未写入——最后一批 flush 丢失，时间点与开发期 vite HMR（App 组件因新增 hook 触发 Fast Refresh 强制 remount，useRef 持久化调度状态全量重建）吻合；结构上 useWorkspaceState 的 debounce/checkpoint 调度状态存 useRef 且无 pagehide/beforeunload 兜底 flush，remount 或关闭都会丢在途批次。数据恢复：将用户保留的完整 review 结论（2264 字符）以 assistant text（item_sort=92）写回 messages 表，重启壳/刷新后可见。

- 2026-09-01T13:41:35.250Z Review 修复（GPT review 三条属实意见）：(1) P1 切换/发送竞态——pendingProviderSwitchRef 记录在途切换，handleSubmitPrompt 先 await 切换落库并用返回的切换后线程快照显式路由（submitPromptToThread(switchedThread)/submitGenericAgentPrompt({thread})），点选后立即发送不再被旧 Provider 闭包路由；切换失败时回滚草稿 Provider；(2) P1/P2 续接标记过早清除——buildPendingContinuationSubmission 不再自清，改为提交被接受（含入队）后由 handleSubmitPrompt 清除，失败重试仍携带转录（无转录可编时才提前清除）；(3) P2 provider 切换时 model/reasoningEffort 未清——applyThreadMetadataPatch 在 providerChanged 时一并置空。契约测试更新覆盖：await 在途切换、switchedThread 路由、delivered 后清除、model 清空。tests/composer-context-usage.test.ts 的 2 个失败经 git stash 基线复跑确证为存量问题，与本次改动无关。DSH dead code warning 属并行 DSH 任务范围，本轮未动。
- 2026-09-01T12:49:17.188Z 端到端根因修复与验证完成：(1) pendingContinuation 改 localStorage 持久化（HMR/刷新不丢标记）；(2) 真正根因——normalizeInputContentBlocks 在 contentBlocks 存在时完全忽略 prompt 字段，注入的转录拼在 prompt 上被丢弃；修复为转录以 text block 前置注入 contentBlocks（prompt 保留为兜底），并在转录尾部加强指令（直接依据转录回答、不要用工具检索）。端到端验证（临时 vite 代理真实后端+Playwright 驱动 UI）：干净聊天 OpenCode 记住生日/暗号/幸运颜色→静默切 Grok Build→一次性全部答对；权限继承与渠道重置亦验证通过。测试 thread 已清理。

- 2026-09-01T12:49:08.681Z Session started.

## Verification
- 2026-09-01T14:24:25.384Z `cargo test; rustfmt --check; npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: 后端 590+16+21 passed 0 failed；rustfmt 通过；typecheck 通过；lib 813 passed；hooks 20 passed。effort 持久化经真实 UI 实测通过。

- 2026-09-01T13:41:35.714Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 813 passed 0 failed；hooks 20 passed 0 failed。待手工验收：切换后立即发送（竞态修复实测）、首次发送失败后重试携带转录。
- 2026-09-01T12:49:17.676Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts`: typecheck 通过；lib 813 passed 0 failed；hooks 20 passed 0 failed。UI 端到端实测通过（OpenCode→Grok Build 首切场景三问全对）。

## Completed

- 2026-09-02T17:19:24.399Z Provider 切换续接任务收口：会话内静默切换（无弹窗）、发送时一次性注入转录（contentBlocks 前置）、竞态与标记持久化修复、权限/模型继承、64MB 历史上限、真实 UI 端到端验证通过并已随 ce6ddd9 提交。手工验收余项已列 Follow-ups。
