# Claude Code UI 包装器

## 目标
- 在 `D:\cursor_project\codem` 创建一个最小可用的本地 UI。
- 通过界面调用本机 `claude` CLI。
- 支持流式输出、会话续接、任务取消、工作目录切换。

## 阶段
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 调研 Claude CLI 输出协议 | completed | 已确认 `--print --verbose --output-format stream-json` 可用 |
| 2. 设计前后端最小架构 | completed | 采用 React + Vite + Express 本地桥接 |
| 3. 搭建项目骨架 | completed | 已创建前端、后端、脚本、样式与 README |
| 4. 实现 Claude 调用链路 | completed | 已支持发送 prompt、解析流式 JSON、取消运行、续接 session |
| 5. 文档与校验 | completed | 已完成 `npm install`、`npm run typecheck`、`/api/health` 校验 |

## 当前决策
- 不直接做 Electron 或 Tauri，先做本地 Web UI，后续可再包桌面壳。
- 默认使用用户本机 `claude` 命令，不绑定 Claude subagent wrapper。
- UI 默认工作目录为 `D:\cursor_project\codem`，但允许改为其他本地目录。

## 风险
- Claude CLI 的参数将来可能变化，后端需尽量做兼容解析。
- Windows 下命令解析与字符流分片需要特别处理。

## 后续增强
- 增加多会话历史列表和本地持久化。
- 增加模型、额外参数、allowedTools 等高级设置。
- 如果要做成桌面端，可在当前基础上再包 Electron 或 Tauri。

## 当前重构计划：Codex Desktop 类对话流
| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. 需求对齐 | completed | 已读取 OpenSpec 中 conversation/tool card/stream activity 相关规范 |
| 2. 数据模型调整 | completed | 已从大 timeline 改为 turn 聚合模型 |
| 3. 工具调用展示 | completed | 工具调用以 inline step 展示，默认折叠参数与结果 |
| 4. 调试信息隔离 | completed | system/raw/snapshot 进入调试抽屉，不进入主对话 |
| 5. 校验与记录 | completed | 已运行 typecheck 并记录结果 |

## UI Contract
- 主对话只展示用户消息、Claude 正文、工具步骤摘要、完成状态。
- 工具步骤按 `toolUseId` 或 block index 聚合，不按每个 event 渲染。
- 工具结果默认折叠，只显示摘要，点击后查看参数、stdout/stderr/完整内容。
- `system/init/hook/status/raw/snapshot` 默认进入调试抽屉。
- 用户消息保留换行、缩进、列表和代码块格式。
- 默认白色主题，避免大框日志感。
