# Session Record: Codex 原生会话压缩

- Session: session-20260801-171404-tnfn
- Started: 2026-08-01T17:14:04.614Z
- Task: .trellis/tasks/codex-native-compact.md

## Notes
- 2026-08-01T18:08:22.525Z P0-2 完整设计已按用户确认写入任务文件，并完成占位符、内部一致性、范围和歧义自审；当前只提交设计与 session record，尚未进入实现。

- 2026-08-01T18:03:22.821Z 用户确认 compact 界面、持久化与安全边界：双入口按能力和会话状态禁用；单卡片展示；复用历史 JSON 的兼容系统事件 turn 与类型化 compact metadata，不新建 SQLite 表；重启只读核对；能力缓存仅内存；不保存上下文正文、环境、敏感错误或原始协议。
- 2026-08-01T18:02:30.696Z 用户确认 compact 状态机与队列规则：waiting/preparing/running/completed/failed/interrupted；重复请求定位原卡片；完成自动释放队列，失败等待 retry 或 skip；重试复用卡片，跳过保留失败事实后放行；自动 compact 复用卡片但无跳过动作。

- 2026-08-01T18:01:22.508Z 用户确认架构与数据流：前端按 thread 独立协调 compact 和队列屏障；双入口共享；后端专用接口将 Compact 串行交给现有热 runtime actor；事件映射携带 provider thread/turn/item ID；历史使用控制型系统节点，自动压缩复用同一模型。
- 2026-08-01T18:00:09.709Z 用户确认采用方案 1：扩展现有 thread 热运行时 actor，将 Compact 作为一等原生操作串行执行；不启动独立竞争进程，不复用普通 prompt 伪装压缩。

- 2026-08-01T17:54:22.674Z 实现路径调研结论：Agent 热运行时 actor 已按 thread 串行处理 Run，适合扩展为一等 Compact 命令并天然落实互斥。能力探测不写死 CLI 版本：初始化后以缺少必填 threadId 的 thread/compact/start 请求做无副作用探测，method not found 判定 unsupported，invalid params 判定 supported，并仅做进程内缓存。备选的独立 app-server 进程会与热 runtime 产生竞态，普通 /compact prompt 又不是真正原生压缩，均不推荐。
- 2026-08-01T17:51:40.264Z 用户确认 manual compact 双入口：保留 /compact，并在上下文用量弹层增加‘压缩上下文’按钮；两个入口必须调用同一控制流程，共享能力判断、互斥、队列屏障、历史卡片和失败恢复，不形成两套逻辑。

- 2026-08-01T17:50:50.607Z 用户确认 compact 失败后的队列策略：失败后保持 compact 屏障并暂停普通排队消息，卡片提供‘重试压缩’与‘跳过压缩并继续发送’两个明确动作；未获用户选择前不得自动继续，也不做隐式自动重试。
- 2026-08-01T17:38:55.914Z 用户确认 compact 历史展示：每次压缩使用单个轻量系统卡片，状态按 waiting/running/completed/failed 原位更新并持久化；区分 manual 与 automatic 来源。失败状态保留可读原因和重试动作，避免为 started/completed/failed 各生成一条历史记录。

- 2026-08-01T17:34:24.189Z 用户确认 compact 重启恢复策略：等待中或执行中的 compact 不跨进程自动重放。应用恢复后先 resume Codex thread 并读取原生历史；存在已完成 contextCompaction item 时同步完成节点，否则把本地请求标记为已中断并提供手动重试。不得静默丢弃，也不得自动重复压缩。
- 2026-08-01T17:18:00.104Z 用户确认 compact 与活动 turn 的互斥策略：运行中输入 /compact 时加入控制队列；当前 turn 完成后，compact 作为队列屏障优先执行，完成或明确失败后才允许普通排队消息继续；不得中断当前 turn，也不得并发启动 compact 与 turn。

- 2026-08-01T17:16:58.589Z 用户确认旧版 Codex CLI 兼容策略：当 thread/compact/start 不受支持时，禁用 Codex 的 /compact，并明确提示升级 Codex CLI；不回退发送普通 /compact 文本，不伪装为已完成压缩。Claude 等其他 Provider 的既有行为保持不变。
- 2026-08-01T17:15:36.169Z 完成 P0-2 现状与协议核对：现有 /compact 仅对 Claude 暴露，并通过普通 prompt + reuseSession=false 执行；本机 codex-cli 0.146.0 experimental schema 确认 thread/compact/start 仅接收 threadId、响应为空对象，压缩过程通过 contextCompaction ThreadItem（item started/completed）表达，thread/compacted 通知已标记 deprecated。实现应以结构化 item 生命周期为主、deprecated 通知仅作兼容。

- 2026-08-01T17:14:04.617Z Session started.

## Verification

## Completed
