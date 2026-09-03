---
name: codem-agent-dev-troubleshooting
description: CodeM 桌面开发的多进程架构真相与 Agent 接入/子进程调试经验。当遇到"改了后端代码但运行行为没变"、dev 壳启动失败（mux 构建拒绝访问）、agent CLI 接入（ACP/-p 探测）、子进程无输出挂起、或怀疑 API/渠道抽风时使用。也适用于给 CodeM 接入新 coding agent CLI 的完整流程。
---

# CodeM Agent 开发与调试经验

## 第一课：改了后端代码但行为没变 → 先查"请求打到哪个进程"

CodeM dev 模式是**多进程架构**，API 请求与二进制版本的对应关系容易错位：

| 进程 | 何时编译 | 职责 |
|---|---|---|
| `codem.exe`（tauri 壳） | tauri watch 检测 src-tauri 改动自动重编 | WebView 宿主，**不监听 API 端口** |
| `codem-agent-mux.exe` | **只在 `desktop:dev` 启动时**由 `buildAgentMuxCli` 编译 | **真正服务 /api**（端口/token 见 `%LOCALAPPDATA%\CodeM Dev\agent-mux-runtime.json`） |
| vite(5173) | 启动时 | 前端，浏览器直连会因 proxy 指向旧端口而失败，不是前端问题 |

**关键推论**：
- 改 `backend.rs` 后 tauri 只重编主程序，**mux 不重编**——必须完整重启 `desktop:dev`（杀光 codem* 进程 → 等 3-8 秒句柄释放 → 重启）。
- **残留 mux 陷阱**：dev 启动失败（常见于 `Agent Mux CLI build failed: 拒绝访问 os error 5` = mux exe 被活着的 mux 进程锁住）时，**旧 mux 进程仍独立服务 API**——你的请求打到旧二进制，修复"从未生效"。此时 `tasklist` 里可能只有 mux 没有 codem.exe。
- 验证运行二进制是否含改动：`python -c "data=open(r'...codem-agent-mux.exe','rb').read(); print(data.count(b'新加的字符串'))"`。
- 验证请求去向：`netstat -ano | findstr <port>` 看监听 PID，`Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>'` 看是哪个 exe、启动时间。

**重启的正确姿势**：杀光 codem/codem-agent-mux → sleep 8 → 确认 `tasklist | rg -i codem` 为空 → `npm run desktop:dev`。启动失败的残留实例要连同后台任务一起停掉。

## 第二课：子进程 spawn 挂起/无输出的排查顺序

Rust/tokio spawn 子进程后无输出，按此顺序排查（都是本次实战踩过的）：

1. **stderr 死锁**：`stderr(Stdio::piped())` 但不读 = 缓冲写满后子进程阻塞挂死。必须后台 drain（`tokio::spawn` 里 `read_to_end` 丢弃或收集用于报错）。
2. **stdin 形态**：交互式 CLI 的 `-p` 模式对 stdin 敏感，`Stdio::null()` 与 piped-then-drop 行为可能不同；参考 ACP 的做法（`acp.rs spawn_with_env_and_removals`：stdin piped + stderr drain task）。
3. **argv 限制**：Windows CreateProcess 约 32K 字符。长 prompt（转录注入）要截断（我们用 24K 上限）或落盘让 agent 用工具读。
4. **`.cmd/.ps1` 不能直接 spawn**：npm shim 需要 `select_runnable_command_candidate` 过滤（复用 CodeM 现成函数），或显式包 `cmd /c`。

**最快定位法——三层对照**：手动终端跑（验证 CLI 本身）→ Node `spawn` 复刻（`stdio:['ignore','pipe','pipe'], windowsHide:true` + 同 cwd/env/args，与 Rust 同层）→ Rust driver。哪层开始失败，差异就在那层与上一层之间。Node 复刻 5 分钟就能写完，远快于给 Rust 加日志。

## 第三课：测试材料本身就是变量

排查"重试风暴/诡异失败"时，先固定测试材料：
- 本次 8×8 纯色小 PNG 让 MiniMax API 稳定返回 500 `system error (1033)`，手动跑同样失败——**不是 driver 的 bug**。用真实截图（几十 KB 以上）测试。
- 对照实验只改一个变量：换图不换命令、换命令不换图。
- kimi 的 `turn.step.retrying` NDJSON 行里带完整 `error_message`——**先看全行再猜**（日志截断 80 字符会切掉关键信息，抓完整行）。

## 第四课：接入新 Agent CLI 的流程（Kimi 模板）

**先探测后写码**：用 ACP 握手脚本（initialize → session/new → session/prompt → session/load）实测能力，别信文档：
- 文本/思考是否 token 级流式（数 chunk 数量和长度）
- session/load 恢复后上下文是否保留（暗号问答法：先记暗号，恢复后问）
- configOptions 里的模型选择器（模型目录来源）
- **image block 发真实图**（某些实现收到图直接挂死且无错误）
- `-p` 会话与 ACP 会话是否互通（`-p` 的 resume_hint id 拿去 ACP `session/load` 试试）

**能力声明原则**：实测过才标 Supported；行为恶劣的（挂死）标 Unsupported 是保护用户。

**接入点清单**（Kimi 为例，全部照抄模式）：
- 前端：`constants.ts` 常量、`types.ts` AgentProviderId、`agent-provider-metadata.ts`、`AgentProviderIcon.tsx`、三处 `Record<AgentProviderId,...>` 补齐（SkillsPanel/useAgentChannels/provider-template-search）、`agent-provider-onboarding-contract.test.ts` 数量断言
- 后端 `agent_runtime.rs`：常量、`is_active_agent_provider_id`、`agent_provider_registry`（参数+descriptor+capabilities）、注册表测试数量断言
- 后端 `agent_run.rs`：CommandResolvers、driver/provider match、ACP 归类行、`acp_arguments`、模型 set 分支、权限模式映射、会话消息、模型目录端点（configOptions 构建）
- 后端 `backend.rs`：命令 resolver（PATH+默认安装目录 fallback）、AgentRunService 装配（含测试装配）、providers 端点、**`settings_provider_id` 白名单**、**lifecycle 安装计划 match**、npm 包名映射、诊断命令 spec、`agent_config_directory_name`——**这三处白名单/match 漏一处就是"设置诊断 400"且很难定位**

**双通道混合模式**（当 ACP 有硬伤但 `-p` 模式能补时）：
- 分流：入口检测 `provider + 输入含 image block` → 独立 `AgentDriverInput` 变体，**不进 runtime dispatch**
- `-p` 通道：图片 path 标签注入 + 转录前缀（复用 `buildProviderContinuationTranscript`）维持上下文；NDJSON 四形态（meta/assistant text/tool_calls/tool result）→ CodeM 事件
- 已知代价：该轮无 token 流式、无审批、会话与主通道不互通

## 速查

- mux runtime 端口/token：`%LOCALAPPDATA%\CodeM Dev\agent-mux-runtime.json`
- 后端日志：`%LOCALAPPDATA%\CodeM Dev\logs\backend.log.<日期>`（http 层只记慢请求和 4xx/5xx）
- HTTP API 全部需要 `Authorization: Bearer <token>`（除 `/api/runtime/identity`）
- curl 测 API：从 runtime.json 取 port+token；SSE 用 python 逐行读
- 长会话历史 PUT 413 = 请求体超限（router 已放宽到 64MB）
