# CodeM 代码仓库审查报告

> 审查日期：2025-05-25
> 审查范围：全仓库代码 + 最近 4 个提交 + 当前未提交变更

---

## 一、当前未提交变更 (`main.rs` + `styles.css`)

### `src-tauri/src/main.rs` — 窗口状态归一化重构 (+187/-31)

**变更概述**：将原来简单的 `is_valid_window_state` 布尔校验重构为 `normalize_window_state` 归一化流程，支持窗口超出显示器边界时自动 clamp 回来，而非直接拒绝。

**评价：质量良好**，主要优点：
- 引入 `MonitorWorkArea` 结构体，解耦了 Tauri Monitor 类型
- `clamp_window_state_to_area` 使用 `saturating_add/sub` 防溢出
- 新增了 4 个单元测试覆盖核心场景
- 保存时从 `outer_size()` 改为 `inner_size()`，更准确
- `persist_window_state` 提取为独立函数，支持归一化后回写

**小问题**：
- `load_window_state` 三层 `.ok()` 静默吞错，配置文件损坏时无任何提示
- 归一化后回写用 `let _ =` 忽略了持久化失败

### `src/styles.css` — 行内代码样式微调

将 `.markdown-body code` 的 `font-size` 从 `0.9em` 调到 `0.92em`，padding 微调，并从 `.codex-desktop` 的代码字体覆盖选择器中移除了 `.markdown-body code`（避免桌面模式下被 `--app-code-font-size` 覆盖）。**无问题。**

---

## 二、Rust 桌面壳 (`src-tauri/src/main.rs`)

| 级别 | 问题 | 位置 |
|---|---|---|
| **高** | `#[cfg(windows)]` + `#[cfg(not(windows))]` 矛盾条件编译，函数永远不会被编译（死代码） | 第 1140-1146 行 |
| **中** | `PtySessions` 缺少 `Drop` 实现，应用退出时终端子进程可能泄漏（对比 `BackendPtyProcesses` 有 Drop） | 第 93-96 行 |
| **中** | 端口分配 `allocate_backend_port` 有竞态窗口（`drop(listener)` 到后端绑定之间端口可被抢占） | 第 724-733 行 |
| **低** | 日志文件 append 模式无轮转，长时间运行会持续增长 | 第 1031-1038 行 |
| **低** | Mutex poison 策略偏严格，一个线程 panic 后功能永久不可用 | 多处 |
| **安全** | 路径无遍历风险，unsafe DWM 调用类型转换正确 | — |

---

## 三、后端代码

### 3.1 `server/index.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **低** | GET `/api/workspace/bootstrap` 无 try-catch，异常直接 500 | 第 377-378 行 |
| **低** | PATCH `/api/workspace/panel` 无 try-catch | 第 395-402 行 |
| **低** | POST `/api/claude/run/:runId/ack` 无 try-catch | 第 1215-1218 行 |
| **低** | DELETE `/api/projects/:projectId` 无 try-catch | 第 503-508 行 |
| **低** | `CODEM_BACKEND_PORT` 环境变量未校验，非数字值导致 `app.listen(NaN)` 失败 | 第 102-103 行 |
| **低** | 多个 PATCH 路由每次更新都调用 `getWorkspaceBootstrap()` 全量查询 | 第 148-191 行 |

### 3.2 `server/lib/claude-service.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **中** | `activeRuns`、`threadActiveRuns`、`threadRuntimes` 三个全局 Map 无容量限制 | 第 269-271 行 |
| **低** | `stdoutBuffer` 理论上可能无限增长（无换行时不截断） | 第 1230-1234 行 |
| **低** | `JSON.parse(trimmed) as ClaudeJsonLine` 强制类型断言无运行时校验 | 第 1347 行 |
| **低** | `scheduleRunRecordCleanup` 的 setTimeout 不持有引用 | 第 1043-1046 行 |

### 3.3 `server/lib/workspace-store.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **高** | 与 `claude-service.ts` 大量重复代码（见 3.7 节） | 多处 |
| **中** | `getWorkspaceBootstrap` 每次调用都执行 `importClaudeSessions` 全量扫描 JSONL 文件 | 第 1943-1975 行 |
| **中** | `readClaudeTranscriptModel` / `readClaudeSessionMetadata` 用 `readFileSync` 读整个文件到内存 | 第 2209-2345 行 |
| **中** | `saveThreadHistory` 先 DELETE 再 INSERT，长对话事务持有写锁时间长 | 第 970-1083 行 |
| **中** | 整个后端大量使用同步 I/O，在 Express 单线程模型下阻塞所有请求 | 全文件 |
| **低** | `startDetachedProcess` 的 `escapePowerShellString` 只处理单引号 | 第 4608-4634 行 |

### 3.4 `server/lib/settings-store.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **低** | `readSettingsFile` JSON 解析失败时静默重置为默认值，用户手动编辑错误会被无提示覆盖 | 第 691-705 行 |
| **低** | `normalizeFontFamilyValue` 不检查 CSS 注入（本地应用风险极低） | 第 740-751 行 |

### 3.5 `server/lib/mcp-manager.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **中** | `writeJsonFile` 非原子写入，断电时配置文件可能损坏 | 第 192-195 行 |
| **低** | `readJsonFileIfExists` 的 `JSON.parse` 失败会抛异常，无本地处理 | 第 183-189 行 |

### 3.6 `server/lib/plugins.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **低** | `runCommand` 子进程无超时机制，命令挂起则 Promise 永不 resolve | 第 318-365 行 |
| **低** | `safeReadDir` 吞掉错误，调用方无法区分"目录为空"和"目录不可读" | 第 584-589 行 |
| **低** | `listSkills` 扫描四层嵌套目录，大量同步文件系统调用 | 第 178-218 行 |

### 3.7 后端重复代码（严重）

以下函数在 `workspace-store.ts` 和 `claude-service.ts` 中完全重复：

| 函数 | workspace-store.ts | claude-service.ts |
|---|---|---|
| `parseRequestUserInputEvent` | 第 4821-4853 行 | 第 2272-2304 行 |
| `parseRequestUserInputQuestion` | 同上 | 同上 |
| `parseRequestUserInputOption` | 同上 | 同上 |
| `hasRequestUserInputShape` | 同上 | 同上 |
| `parseApprovalRequestEvent` | 第 4922-4952 行 | 第 2625-2658 行 |
| `stringifyClaudeContent` | 第 5590-5614 行 | 第 2114-2145 行 |
| `asRecord` / `firstNonEmptyString` / `normalizeToolName` | 第 2679-2683 行 | 第 2679-2683 行 |

建议提取到 `server/lib/claude-parsers.ts` 共享模块。

---

## 四、前端代码

### 4.1 `src/hooks/useClaudeRun.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **高** | Hook 规模过大（~2500 行、11 个 useState、8 个 useRef、7 个 useEffect），状态间依赖复杂 | 全文件 |
| **中** | 闭包陷阱：`reconnectActiveRun` 的 useEffect 依赖数组缺少 `models`、`permissionMode` 等变量 | 第 273-275 行 |
| **中** | `reconnectActiveRun` 未传 abort signal，重连的事件流无法取消 | 第 892-995 行 |
| **中** | `maybeStartQueuedPrompt` 的 setTimeout 无取消机制 | 第 627-649 行 |
| **低** | `runningThreadIds`、`isRunning` 等每次渲染都重新计算，可用 `useMemo` | 第 193-201 行 |
| **低** | 多处 `as` 类型断言（`as ClaudeModelInfo` 等）无运行时校验 | 第 287-291, 303, 909 行 |

### 4.2 `src/hooks/useWorkspaceState.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **中** | `loadThreadHistory` 快速切换线程时有竞态条件 | 第 124-133 行 |
| **中** | `threadDetails` 包含所有线程完整详情无上限，长时间使用后内存增长 | 第 57-59 行 |
| **中** | `persistHistoryStateRef` Map 按线程 ID 存储但删线程时不清理 | 第 69-80 行 |
| **中** | `syncWorkspace` 全量覆盖 `projects`，可能丢弃已加载的线程详情 | 第 166-198 行 |
| **低** | `appendDebug` / `appendRawEvent` 在高频 streaming 中使用 `startTransition`，可能与同步状态更新产生不一致中间状态 | 第 426-464 行 |
| **低** | `persistSelection` 和 `handlePanelStateChange` 中 fetch 无错误处理 | 第 1024-1063 行 |
| **低** | `ThreadMetadataPatch` 类型与 `useClaudeRun.ts` 重复定义 | 第 22-27 行 |

### 4.3 `src/lib/conversation.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **中** | `repairConversationTurn` 每次 turn 更新都重建完整 Map，高频 streaming 下性能浪费 | 第 41-90 行 |
| **低** | `splitToolInputChunks` 手写 JSON 解析器不处理模板字符串、注释、Unicode 转义等边界情况 | 第 1148-1213 行 |
| **低** | `appendTextItem` / `syncToolItem` 每次调用创建新数组，streaming 下 GC 压力大 | 第 257-320 行 |
| **低** | `parseLooseJson` 解析失败返回 `undefined`，无法区分格式错误和缺失 | 第 839-849 行 |

### 4.4 `src/components/Composer.tsx`

| 级别 | 问题 | 位置 |
|---|---|---|
| **低** | `selectionStart`/`selectionEnd` 用 state 而非 ref 存储，每次 onChange 触发额外重渲染 | 第 110-111, 463-470 行 |
| **低** | Mic 按钮无事件绑定，是无效 UI 元素 | 第 683 行 |
| **低** | `updateDraftSelection` 的 `requestAnimationFrame` 无清理 | 第 287-296 行 |

### 4.5 `src/components/ConversationTurn.tsx`

| 级别 | 问题 | 位置 |
|---|---|---|
| **中** | 大列表无虚拟化，工具密集型对话可能产生大量 DOM 节点 | 全组件 |
| **低** | `extractCodeText` 依赖 React 内部 `props` 结构，React 19 可能改变 fiber | 第 1727-1742 行 |
| **低** | `memo` 的浅比较可能因父组件每次渲染创建新函数引用而失效 | 第 379 行 |
| **低** | `changedFileGroups` 和 `undoChanges` 各自独立遍历 `turn.tools`，重复计算 | 第 118-119 行 |

### 4.6 `src/types.ts`

| 级别 | 问题 | 位置 |
|---|---|---|
| **低** | `ConversationTurn` 有 20 个字段中 14 个可选，可拆分为 `PendingTurn`/`RunningTurn`/`CompletedTurn` | 第 160-186 行 |
| **低** | `ToolStep.subMessages` 类型为 `string[] | undefined`，每次操作需 `?? []` 防护 | 第 127 行 |

### 4.7 前端重复代码（严重）

以下逻辑在 2-3 个文件中重复出现：

| 逻辑 | 重复位置 |
|---|---|
| `isApprovalRequiredTool*` 检查 | `useClaudeRun.ts` + `ConversationTurn.tsx` |
| `isSecurityPolicyBlockedTool*` 检查 | `useClaudeRun.ts` + `ConversationTurn.tsx` |
| `isPlanApprovalRequest` | `useClaudeRun.ts` + `ConversationTurn.tsx` |
| `parseUsageBlock` + `formatUsageTokenCount` + `formatUsageDuration` | `conversation.ts` + `ConversationTurn.tsx` |
| `describeToolCall` 工具名称匹配逻辑 | `conversation.ts` + `ConversationTurn.tsx` |
| `ThreadMetadataPatch` 类型 | `useWorkspaceState.ts` + `useClaudeRun.ts` |

建议提取到 `src/lib/claude-tool-utils.ts` 共享模块。

---

## 五、最近 4 个提交

### `cd3ef34` — fix: surface claude retry status

**评价：通过**

| 级别 | 问题 |
|---|---|
| **低** | `ConversationTurn.tsx` 硬编码中文字符串做 activity 排除（`activity !== '等待 Claude 响应'`），后端改文案前端就失效 |

### `81fb510` — fix: refine claude model selector

**评价：通过**

| 级别 | 问题 |
|---|---|
| **低** | 第三方网关 model 名含 `sonnet`/`opus` 但不支持 `[1m]` 时会显示无效 1M 开关 |
| **低** | 用户已保存 `opusplan` 作为默认模型时会静默切换到 `__default`，无用户提示 |

### `abd71ee` — feat: add claude 1m and effort controls

**评价：通过（有建议）**

| 级别 | 问题 |
|---|---|
| **低** | `.model-context-toggle` CSS 硬编码颜色（`rgba(120,120,128,0.24)`、`#686868`），暗色模式不自适应 |
| **低** | `model-menu-item` 从 `<button>` 改为 `<div role="menuitemradio">`，降低原生可访问性 |
| **低** | `contextWindowTokens` 类型字段声明但后端从未赋值，属冗余声明 |

### `8fd896e` — chore: unify tooltips and refresh app icon

**评价：通过（有建议）**

| 级别 | 问题 |
|---|---|
| **中** | MutationObserver `subtree:true` 在大量 DOM 变更时（如加载历史消息）可能有性能开销 |
| **低** | `createPortal` 容器 `.codex-desktop` 如有 `transform` 属性会导致 tooltip `position:fixed` 定位偏移 |
| **低** | 包含与 tooltip/图标无关的测试修复，降低了提交原子性 |

---

## 六、优先改进建议（按优先级排序）

### P0 — 应尽快处理

1. **提取后端共享代码** — `workspace-store.ts` 和 `claude-service.ts` 的重复解析函数提取到 `server/lib/claude-parsers.ts`
2. **删除 Rust 死代码** — `main.rs` 第 1140-1146 行矛盾条件编译

### P1 — 近期改进

3. **为 `PtySessions` 添加 `Drop` 实现** — 确保应用退出时终端子进程被清理
4. **`importClaudeSessions` 增量化** — 记录上次扫描时间戳，避免每次 bootstrap 全量扫描
5. **提取前端共享代码** — `isApprovalRequired*`、`parseUsageBlock` 等提取到 `src/lib/claude-tool-utils.ts`
6. **`useClaudeRun` 拆分** — 考虑将流处理、权限管理、模型选择等拆分为独立 hook

### P2 — 中期优化

7. **补齐后端缺失的 try-catch** — 4 个遗漏的错误处理路由
8. **`mcp-manager.ts` 原子写入** — 仿照 `settings-store.ts` 使用临时文件 + rename
9. **后端热路径同步 I/O 替换** — 特别是 `getWorkspaceBootstrap`、`importClaudeSessions`
10. **前端 `ConversationTurn` 大列表虚拟化** — 工具密集型对话性能优化

### P3 — 远期规划

11. **`types.ts` 状态类型拆分** — `ConversationTurn` 按阶段拆分减少可选字段
12. **TooltipLayer 性能优化** — MutationObserver 回调增加 `requestIdleCallback` 批量处理
13. **日志轮转机制** — 桌面应用日志文件增加大小上限
14. **Mutex poison 策略调整** — 考虑 `into_inner()` 恢复模式提升桌面应用容错性
