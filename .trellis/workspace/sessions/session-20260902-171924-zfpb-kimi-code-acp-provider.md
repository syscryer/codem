# Session Record: 接入 Kimi Code（ACP）

- Session: session-20260902-171924-zfpb
- Started: 2026-09-02T17:19:24.844Z
- Task: .trellis/tasks/kimi-code-acp-provider.md

## Notes

- 2026-09-03T17:24:30.562Z Codex review 第二轮修复：(P1-#3) default 权限下拒绝 Kimi 图片 print 路径——kimi -p 恒 auto 无法逐项审批，提示词约束实测可被穿透，改为后端 bad_request 明确提示需自动/完全访问权限；(P1-#2) 新聊天首条图片的续接标记写入时机移到 ensureAgentThread 之后（此时才拥有真实 thread id），下一条文本可正确衔接；附带两项：print 分支的 file_reference/file_text/attachment_metadata 块降级为路径/描述文本不再静默丢弃（模型可自行读取）、base64 落盘的临时图片在终态（成功/失败/取消）后删除（用户原路径不动）。全量通过：591+16+21 / lib+hooks / typecheck / rustfmt。
- 2026-09-03T17:02:21.548Z Codex review 五项修复：(1) resolve_requested_thread_provider 白名单漏 Kimi（UI 新建 Kimi 聊天 400 '不可用于新建聊天'）——三处（模式/Ok 映射/错误消息）补齐，skill 接入清单的白名单数量更新为四处；(2) 图片轮转录注入只拼 prompt 被 contentBlocks 覆盖（与切换续接同源的坑）——改为 text block 前置注入 contentBlocks，prompt 仅兜底；(3) 图片轮后上下文断裂——图片轮提交即写 localStorage 标记（codem:kimi-image-continuation:<threadId>），下一轮 Kimi 提交（无论通道）检测标记注入含图片轮的完整转录（ACP 照常 resume，转录补齐图轮上下文）后清除；(4) print 轮权限预期——-p 恒 auto 无法硬限制，prompt 外层包裹图片分析轮约束（禁修改性工具）软性降险，已知限制维持记录；(5) tool-result is_error 硬编码 false——按内容特征（error:/exit code/command failed/not found/permission denied，前 300 字符）启发式判定失败。全部测试通过（591+16+21 / 813+20 / typecheck）。

- 2026-09-03T10:29:22.084Z 修复 ACP 权限模式不生效：acp_permission_policy 原来只对 OpenCode 应用 auto/bypassPermissions 自动审批策略，其余 ACP Agent（DSH 等）一律 Interactive——用户选"完全访问"仍弹权限确认。DSH ACP 无 session modes（探测确认 set_mode 无响应、session/new 不返回 modes），权限完全靠客户端 request_permission 应答，故策略放开到所有 ACP Agent：auto→AutoApproveOnce、bypassPermissions→AutoApproveAlways（Grok/Gemini/Kimi 有服务端 mode 控制的仅作兜底）。测试断言更新（grok/dsh bypass→AutoApproveAlways、dsh default→Interactive），591+16+21 全过。
- 2026-09-03T10:16:12.680Z DSH 0.1.2-rc.1 复测：ACP 流式仍未补上（agent_message_chunk 仍一帧全文、22s 等待后整块；dsh-acp 桥源码仍为 committed events 派生架构）；ACP 图片仍无响应；会话恢复正常（暗号验证）。CodeM 侧无需改动，等上游桥接层改接实时流后自动恢复流式。

- 2026-09-03T10:08:48.125Z Kimi 图片混合通道完成并端到端验证通过：后端 KimiPrint 驱动（AgentDriverInput::KimiPrint 分流——Kimi+image block 不进 ACP runtime；spawn kimi -p --output-format stream-json，NDJSON 四形态映射 Delta/ToolStart/ToolResult/Done；图片优先用 path、仅 base64 时落盘 temp/codem-kimi-images；argv 24K 截断；stderr 后台 drain 防管道死锁；kill_on_drop 支持取消）；前端 useAgentRun 对 Kimi 带图消息注入会话转录前缀（print 进程无会话上下文，复用切换续接转录编译器）；capabilities.images 放开。排查纪要：调试过程中三次误导——mux 残留旧二进制（dev 因 mux 构建占用启动失败时 API 由残留旧 mux 服务，修复从未生效）、stderr piped 死锁（已修）、最终确认 8x8 极小测试红图触发 MiniMax API 500 system error(1033)（手动同图同样重试，非 driver 缺陷）；正常 64x64 图端到端全通（流式 delta+done+模型读到图像元数据）。已知限制：带图轮整块输出无 token 流式、无审批（-p 恒 auto）、ACP 会话看不到带图轮内容（下次带图靠转录衔接）。
- 2026-09-03T02:17:21.926Z Kimi 图片输入双路径实测：-p 模式（--output-format stream-json）支持图片——<image path> 标签注入后 Kimi 自动调 ReadMediaFile 返回 image_url 多模态块，模型正确识别颜色（实测蓝色图答'蓝色'）；但 ACP 模式图片挂死于 0.39.1 与 0.40.1（npm 最新版实测仍 75s 无响应无错误）均复现；且 -p 会话与 ACP 会话不互通（session/load 失败）。结论：图片能力只有 -p 路径可达成，需独立 -p 驱动分支（每次带图消息 spawn 一次性进程 + 会话转录注入维持上下文），中等工作量，待用户决策是否实现。

- 2026-09-03T02:08:36.619Z Kimi Code 图标替换为用户提供的图片：129152888.jpg（60x60 白底）经 PIL 抠白转透明存为 src/assets/provider-icons/kimi-code.png，AgentProviderIcon 改为 img 渲染分支（与 Hermes/DSH 同款）。assets 中另有 Lobe Icons 官方 kimi.svg 备选。
- 2026-09-03T01:53:16.757Z Kimi 能力声明实测核验：图片输入经 ACP image block（8x8 红色 PNG base64）实测——kimi acp 0.39.1 收到后静默挂起（45/90 秒无事件无错误无 stopReason），确认不支持且行为为挂死而非报错，capabilities.images=Unsupported 的保守声明正确且必要（前端将禁用附件入口避免挂死）。MCP 未能低成本实测，维持保守 Unsupported。会话列表/导入为真实缺接口。'软取消'为 ACP 协议取消语义（发 cancel 信号而非杀进程），与 Grok/OpenCode/DSH 一致。

- 2026-09-03T01:46:52.839Z 修复 Kimi 设置诊断 400：诊断端点除 settings_provider_id 白名单外还无条件构建安装/更新命令（build_agent_lifecycle_plan 与 npm 包名映射两处 match 均无 Kimi 分支）。补齐：白名单、lifecycle 计划（npm 官方包 @moonshot-ai/kimi-code@latest）、npm 包名映射、诊断命令 kimi doctor。另发现并理解 dev 架构：API 由 agent-mux 进程应答，mux 二进制只在 desktop:dev 启动时编译，改 backend.rs 后必须完整重启 desktop:dev（tauri watch 只重编主程序）。诊断端点实测返回 version=0.39.1/installed/installCommand/diagnosticCommand/configDirectory 全部正确。
- 2026-09-03T01:21:40.713Z Kimi Code ACP 接入实现完成：后端（agent_runtime 常量/注册表/kimi_capabilities 保守声明、agent_run 驱动归类/命令解析/acp_arguments('acp')/权限模式映射(default/auto/yolo)/模型 set_config_option/会话消息/Kimi 模型目录端点（configOptions 构建器）、backend resolve_kimi_command（PATH+~/.kimi-code/bin）+providers 端点+配置目录 .kimi-code）、前端（constants/types/metadata/图标/三处 Record 补齐/契约数量 9）。端到端验证：providers 列表 available=true；模型目录返回 7 个 MiniMax 模型（默认 minimax-cn/MiniMax-M3）；真实 run 全链路通过——'已创建 Kimi ACP 会话'、thinking/text token 级流式、done 终态、回复正确（模型自述 MiniMax-M3）。LLM provider 经 kimi provider catalog add minimax-cn 配置（用户 API key 存于本机 Kimi 配置，未入仓库）。前端 813+20、后端 591+16+21 全部通过。

- 2026-09-02T17:19:24.849Z Session started.

## Verification
- 2026-09-03T01:21:41.135Z `npm run typecheck; node --import tsx --test src/lib/*.test.ts; node --import tsx --test src/hooks/*.test.ts; cargo test; rustfmt --check`: typecheck 通过；lib 813 passed；hooks 20 passed；cargo 591+16+21 passed；rustfmt 通过；UI/API 端到端实测通过（流式+会话+模型目录）。

## Completed

- 2026-09-03T17:33:10.046Z Kimi Code ACP 接入完成并经两轮 review 修复（图片混合通道/权限语义/续接闭环/四处白名单），端到端验证通过，随 0565b87 提交。
