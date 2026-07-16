# Task: Agent 渠道管理

## Background

当前“Agent 与模型”页面将 Agent CLI 管理和 Claude 模型默认值并列展示，但无法说明 Agent 当前实际采用的上游配置，也无法在未安装 CC Switch 时维护可复用的 Agent 渠道。普通聊天已经具备独立供应商机制，本任务需要为 Agent 建立独立且不混用的数据和运行边界。

## Objective

保持 Agent 当前默认配置行为不变，展示系统当前渠道；新增 CodeM 内全局渠道管理，CodeM 渠道仅注入由 CodeM 启动的 Agent 子进程，同时隔离普通聊天配置

## Scope

In scope:

- 将原“提供商”标签改名为“Agent 管理”，继续承载 CLI 可用性、版本、登录、能力和原生诊断。
- Agent 管理为 Claude Code、Codex、Grok Build、OpenCode 提供安装状态、当前版本、安装命令和更新命令；未安装时可以一键安装，已安装时可以一键更新。
- 一键安装和更新只接受后端固定的 Agent Provider ID，由后端生成并执行受控命令；前端不能提交任意 shell 命令，执行完成后必须重新探测真实 CLI 状态。
- 将原“模型与默认值”标签完整替换为“渠道管理”，不保留旧模型默认值页面。
- 按 Claude Code、Codex、Grok Build、OpenCode 展示系统当前配置，并将其作为只读虚拟渠道。
- 系统当前配置优先读取 Agent CLI 的真实 live 配置；能够识别 CC Switch 时补充来源信息，但不依赖 CC Switch 才能工作。
- 支持 CodeM 渠道的新增、编辑、删除、启停、默认选择、连接测试、模型获取、模型多选和手工模型维护。
- 同一 Agent Provider 可以维护多个 CodeM 渠道，渠道列表在 CodeM 内全局共享。
- API Key 使用本地加密 vault，数据库、任务记录、日志、trace 和前端 bootstrap 不返回明文。
- CodeM 渠道通过 Agent 子进程环境或隔离配置注入，不覆盖系统当前配置。
- Grok Build 使用其原生自定义模型机制，支持 chat_completions、responses 和 messages，并优先使用 GROK_MODELS_BASE_URL / GROK_MODELS_LIST_URL / XAI_API_KEY 做进程隔离。
- 新建 Agent 任务默认跟随系统当前配置；CodeM 渠道选择按任务保存，运行中的热会话不被外部配置切换强制改变。
- 保留现有权限、思考强度和语言设置边界，不把它们混入渠道配置。

Out of scope:

- 不修改或写入 CC Switch 数据库，不复制、导入或双向同步 CC Switch 渠道。
- 不把普通聊天供应商实例复用为 Agent 渠道，也不改变普通聊天、知识库、MCP 或 Skills 的运行机制。
- 不修改 ~/.claude、~/.codex、~/.grok 或 OpenCode 的全局配置，不提供系统配置覆盖、备份或恢复入口。
- 不展示或持久化 Agent 内部隐藏思考链。
- 不自动安装 Node.js、包管理器或系统级依赖；缺少前置环境时展示真实错误和可复制的安装命令。

## Impact

- Frontend：Agent 设置导航、渠道管理组件、任务渠道选择、类型和 API client。
- Backend：Agent 渠道表、模型表、密钥槽、当前配置诊断、管理 API 和各 Agent runtime 启动注入。
- Persistence：新增独立 Agent 渠道持久化，不修改普通聊天表语义；线程需要记录所选渠道快照或引用。
- Security：API Key 不进入 SQLite 明文字段、app settings、Git、日志、调试事件或导出内容。

## Acceptance Criteria

- [x] 设置页标签显示为“Agent 管理”和“渠道管理”，原“模型与默认值”页面不再出现。
- [x] 每个受支持 Agent 都展示安装状态、当前版本、安装命令和更新命令；命令支持复制。
- [x] 未安装的 Agent 可以一键安装，已安装的 Agent 可以一键更新；执行期间显示进度并禁止重复操作，完成后刷新真实版本和可执行文件状态。
- [x] 安装和更新接口只执行后端白名单 Provider 的固定策略，不接受前端传入的命令文本；失败时返回经过长度限制且不包含环境密钥的真实输出摘要。
- [x] 每个 Agent 都能看到系统当前配置卡片；无 CC Switch 时仍能读取或明确说明当前配置状态。
- [x] CC Switch 切换后刷新页面能看到新的系统当前配置，CodeM 不写回 CC Switch。
- [x] 同一 Agent 可创建多个 CodeM 渠道，完整支持编辑、删除、启停、默认、密钥查看、测试和模型维护。
- [x] 获取模型支持多选添加；不支持远程模型列表的渠道允许手工添加模型。
- [x] API Key 仅保存在加密 vault，常规列表和日志只暴露是否已保存。
- [x] Claude Code、Codex、Grok Build、OpenCode 选择 CodeM 渠道后，只影响对应 CodeM 任务进程。
- [x] 运行中的热会话不会因系统当前配置或 CC Switch 切换而隐式更换渠道。
- [x] Grok Build 自定义渠道可以通过真实 OpenAI 兼容测试地址获取模型并完成一次消息请求。
- [x] CodeM 不提供系统全局应用操作；无论是否检测到 CC Switch，都不会写入 Agent 或 CC Switch 的全局配置。
- [x] 普通聊天供应商、普通聊天会话和 Agent 渠道之间不存在数据串用。
- [x] 刷新和重启后 CodeM 默认渠道、任务渠道选择及模型选择能够恢复。

## Verification Commands

- `npm run typecheck`
- `npx tsx --test <全部 src/**/*.test.ts>`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run desktop:dev` 后手工验证 Agent 管理、渠道 CRUD、Grok Build 渠道和系统配置保护。

## Implementation Record

- 2026-07-16T03:09:21.197Z 修复渠道切换与首条消息竞态：活动线程立即使用界面最新渠道，后台队列继续使用已持久化渠道；Grok OpenAI Chat 渠道生成 chat_completions 自定义模型别名，并通过 GROK_AUTH_PATH 复用原生登录状态，不复制或读取认证内容。
- 2026-07-16T03:09:13.190Z 完成 Agent 渠道管理跨层实现：Agent、渠道、模型独立选择；CodeM 渠道 CRUD、vault 密钥、测试、模型发现与维护；四类 Agent 受控安装更新；渠道按任务持久化并注入隔离子进程；停用或删除渠道同步清理线程运行状态、模型偏好和 Grok 隔离目录。

- 2026-07-16T01:10:22.485Z 扩展 Agent 管理范围：四个受支持 Agent 增加安装状态、安装命令、更新命令、一键安装和一键更新；后端仅执行 Provider 白名单固定策略，前端不能提交任意命令。
- 2026-07-15T19:21:36.811Z 已按最终方案移除系统全局配置写入、备份和恢复范围；CC Switch 仅只读识别，CodeM 渠道仅注入 CodeM 启动的 Agent 子进程。

- 2026-07-15T18:51:27.170Z 已更新并核对 CC Switch main f6e37ed9；Agent 渠道模块通过 cargo check，系统当前配置从 Claude/Codex/Grok/OpenCode live 配置读取，CC Switch 仅只读查询当前渠道名称，不读取 settings_config 或密钥。
- 2026-07-15T18:22:54.631Z 已确认页面命名：原提供商改为 Agent 管理，原模型与默认值替换为渠道管理；已固化系统当前配置、CodeM 渠道、CC Switch 只读集成、进程隔离、Grok Build 自定义端点和系统全局高级操作边界。

- 2026-07-15T18:18:57.193Z Task created by Trellis automation.

## Verification Results
- 2026-07-16T03:10:26.775Z `git diff --check 与仓库长密钥模式扫描`: 通过：未发现空白错误，未发现 sk-... 长密钥模式。

- 2026-07-16T03:10:18.770Z `真实 Grok Build OpenAI 兼容渠道联调（密钥经本地 vault 注入）`: 通过：DeepSeek 兼容端点连接测试成功，发现并保存 2 个模型；Grok ACP 返回 delta、done 和期望文本 CODEM_AGENT_CHANNEL_OK；临时渠道、vault 槽及隔离运行目录均已清理。
- 2026-07-16T03:10:11.416Z `Playwright 桌面与 900px 窄屏手工验收`: 通过：Agent 管理和渠道管理页面无水平溢出、无内层内容滚动条，厂商下拉支持 Esc 和尺寸变化关闭并恢复焦点，控制台无错误。

- 2026-07-16T03:09:58.283Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 131 项通过、1 项真实 Grok smoke 按设计忽略；desktop main 9/9 项通过。仅有既有 OrdinaryChatService::new 未使用警告。
- 2026-07-16T03:09:45.638Z `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: 通过。

- 2026-07-16T03:09:36.998Z `npx tsx --test <全部 85 个 src/**/*.test.ts>`: 通过，共 493/493 项 TypeScript 测试通过。
- 2026-07-16T03:09:29.096Z `npm run typecheck`: 通过，无 TypeScript 类型错误。

## Completion Summary
- 2026-07-16T03:11:37.030Z Agent 渠道管理完整版已完成：支持四类 Agent 的系统配置只读展示、受控安装更新、CodeM 全局多渠道与模型管理、vault 密钥保护、任务级渠道持久化和隔离运行；修复渠道切换竞态及 Grok 自定义模型运行链路，全部自动化、桌面视口和真实渠道联调验证通过。

## Follow-ups

- 根据 Grok Build 后续 CLI 版本变化持续校准自定义模型配置字段和 ACP 能力。
