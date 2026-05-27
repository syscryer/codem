# Task: ccswitch Provider 与 CodeM Runtime 同步规划

## 背景

用户通过 `ccswitch` 从 GLM 切换到 Mimo 后，CodeM 仍可能展示或继续使用旧的 `glm-5.1`。发送请求后，Claude Code / 网关返回 `API Error: 400 Param Incorrect`。

这个问题不能只在模型下拉或发送参数上补一个局部判断，因为它同时牵涉：

- `/api/claude/models` 读取外部 Claude 配置的时机
- Composer 当前选中模型和实际发送 `--model` 的关系
- thread metadata 中保存的模型语义
- 后端热 runtime 的复用条件
- 运行中会话、排队消息、审批/问答暂停、冷恢复 `sessionId`
- 设置页模型默认值与自定义模型

## 目标

- CodeM 能识别 `ccswitch` 修改后的 Claude provider/model 配置，并在下一次合适的时机同步。
- 从 GLM 切到 Mimo 后，默认模型路径不再继续显式发送旧的 `glm-5.1`。
- provider 配置变化后，不复用绑定旧 provider 的空闲热 runtime。
- 正在运行中的 runtime 不被强制切换或杀掉，避免破坏当前输出、审批、问答流程。
- provider 切换后尽量保留 thread/session 连续性：热进程可以失效，但会话历史和 `sessionId` 冷恢复能力不应被无谓丢失。
- 新增诊断信息能解释一次请求使用了哪个 provider 指纹、哪个模型参数、是否复用 runtime。

## 非目标

- CodeM 不替代 `ccswitch`。
- CodeM 不切换 provider、不编辑 base URL、不保存 API key、不改 `ccswitch` 配置文件。
- 不把 provider 详情完整展示成可编辑设置。
- 不引入新的多 provider 抽象层；本阶段仍围绕 Claude Code CLI 当前能力做同步。
- 不为了解决本问题重构整个 `useClaudeRun` 或 workspace store。

## 当前关键事实

- 前端启动和非运行线程切换时会调用 `/api/claude/models`。
- `src/hooks/useClaudeRun.ts` 中 `resolveInitialClaudeModelId(...)` 会根据 thread model、模型列表和设置默认值决定 UI 选中项。
- 发送时 `resolveRequestModel(findModelOption(models, runModel), runModel)` 决定是否传 `model` 给 `/api/claude/run`。
- `server/lib/claude-models.ts` 从 `~/.claude/settings.json` 和进程环境读取 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL` 等配置。
- GLM provider 可能把 default、sonnet、opus、haiku 全部映射到同一个 `glm-5.1`。
- `server/lib/claude-service.ts` 的 `isRuntimeCompatible(...)` 目前只比较 workspace、permission mode、model、effort、sessionId 等，没有比较外部 provider 配置。
- 当请求走默认模型时，`input.model` 是 `undefined`；provider 已从 GLM 切 Mimo 时，旧 runtime 和新请求仍可能都满足 `runtime.model === input.model`，导致旧 GLM runtime 被误复用。
- 现有规范已经要求：运行中的热会话不要强制同步外部 provider 配置；非运行线程切换时可以刷新 provider/model 配置。

## 设计原则

1. **默认是语义，不是具体模型值**
   `__default` 表示“不传 `--model`，让 Claude Code 使用当前 provider 默认模型”。它不应该被持久化成 `glm-5.1` 这类 provider 专属默认值。

2. **展示模型和请求模型分开**
   UI 可以展示“当前默认是 glm-5.1 / mimo-xxx”，但发送默认模型时仍应传 `undefined`，不能把展示值当成稳定请求参数。

3. **provider 指纹只读、脱敏、可比较**
   CodeM 只读取 Claude Code 当前可见配置，计算稳定指纹用于同步和诊断；不能暴露 API key、token、代理密码等敏感内容。

4. **热 runtime 只在同一运行环境下复用**
   runtime 复用条件应包括 provider 指纹。provider 指纹变化时，旧 runtime 对下一次请求不再兼容。

5. **运行中不抢方向盘**
   当前正在输出、等待审批或等待用户输入的 runtime 不因为外部 provider 变化被强制切换。切换只影响后续新 run 或空闲 runtime 复用判断。

6. **先诊断，后改行为**
   先让 `/api/claude/models`、trace、runtime status 能说明当前读到的 provider 摘要和请求决策，再逐步收紧行为，避免盲调。

## 推荐方案

采用“只读 provider 指纹 + 下一次发送前模型快照刷新 + runtime 兼容性校验”的组合方案。

核心产品决策：

- `ccswitch` 引起的 provider 变化不在 CodeM 内即时切换运行时。
- CodeM 不把窗口聚焦、设置页返回、模型菜单展开作为 provider 生效点。
- provider 切换只在下一次真实发起 Claude run 前生效。
- 如果消息先进入队列，入队时不切换；轮到队列项真正开始执行时再读取最新 provider。
- 启动或切到非运行线程时可以刷新展示快照，但不能因此关闭 runtime 或重置当前运行。

### Provider 指纹

新增一个后端只读 helper，从 Claude Code 当前配置里提取影响 provider/runtime 的配置摘要：

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `CLAUDE_CODE_DISABLE_1M_CONTEXT`
- 影响 provider 的已知环境变量存在性和脱敏 hash，例如 auth token、API key、代理地址

返回给前端和 trace 时只包含：

- `fingerprint`: hash 后的稳定字符串
- `defaultModel`: 当前默认模型名，不含 token
- `baseUrlHost`: 可选，只显示 host 或 provider label，不显示完整带凭据 URL
- `source`: `claude-settings` / `process-env` / `mixed`
- `updatedAtMs`

不返回：

- API key/token 原文
- 带账号密码的 URL
- 完整代理凭据

### 模型列表契约

扩展 `/api/claude/models`：

- 保持现有 `available`、`models`、`error` 字段兼容。
- 增加 `provider` 摘要和 `fingerprint`。
- 默认模型 option 继续使用 `id: "__default"`。
- 默认模型 option 的 `model` 可作为展示用当前模型，但前端发送时必须保持“默认不传 model”的规则。

### 前端同步策略

- 应用启动时可以刷新模型列表，用于展示当前默认模型。
- 非运行线程切换时可以刷新模型列表，用于展示和归一 UI，但不触发 runtime 切换。
- 窗口聚焦、设置页返回、模型菜单展开不作为 provider 切换触发点，避免用户外部试 provider 时让 CodeM 状态抖动。
- 点击发送前必须刷新 `/api/claude/models`，并基于最新快照解析 `runModel`。这是 provider 切换对 CodeM 生效的唯一前端入口。
- 如果当前选中模型已经不适用于新模型列表：
  - 旧 provider 专属默认模型，例如 `glm-5.1`，回落到 `__default`。
  - Claude slot 或 1M alias 在当前 provider 不可用，回落到 `__default`。
  - 用户自定义模型保留，因为它是显式输入。
- trace 中记录 `selectedModelId`、`requestModel`、`providerFingerprint`，便于定位“UI 选了什么”和“实际传了什么”。

### Thread metadata 策略

- 保存 thread model 时保存“用户选择语义”，不是默认模型解析值。
- `__default` 不写成具体 provider 默认模型。
- 对 provider slot，例如 `sonnet`、`opus`、`haiku`，可以保存 slot id；切 provider 后由当前模型列表重新解释。
- 对 `context1mModel` 和自定义模型，保留用户显式选择。
- 历史 transcript 中读取到的 `message.model` 只作为历史展示/使用统计，不应覆盖 Composer 当前默认选择。

### 后端 runtime 策略

- `StreamInput` 或 runtime 创建流程中记录请求时的 provider fingerprint。
- `ClaudeRuntime` 保存 spawn 时的 provider fingerprint。
- `isRuntimeCompatible(...)` 增加 provider fingerprint 比较。
- provider fingerprint 变化时：
  - 如果 runtime 空闲，关闭旧 runtime，spawn 新 runtime。
  - 如果 runtime 正在运行，保持当前 run；同线程新 prompt 仍进入队列或被前端阻止，不能强制抢占。
  - 下一次真正开始 run 时重新判断 fingerprint。
- `/api/claude/runtimes` 返回脱敏 provider fingerprint 和 default model 摘要，方便设置页诊断。

### 热会话与冷恢复准则

- 同 provider、同 workspace、同 permission、同 model、同 effort、同 session 时，热 runtime 继续复用。
- provider 变化后，旧热进程不再复用，这是必要的，否则会继续走旧 provider 或带旧模型参数。
- provider 变化不等于 thread 失效。已有 `sessionId` 仍可用于冷恢复，除非 Claude Code 明确返回 resume 不可用。
- 如果冷恢复失败，前端应展示可恢复提示，而不是静默创建看似同一个但实际断开的线程。

### 队列策略

第一版建议选择安全优先：

- 队列项入队时不读取 provider，也不锁定 provider。
- 队列项真正开始发送前重新走一次发送前模型解析和后端 runtime 兼容校验。
- 如果用户在当前 run 运行中切换了 provider，当前 run 不受影响；队列项启动时才使用新的 provider fingerprint，不复用旧 runtime。
- 这样会牺牲“跨 provider 切换后的热进程连续性”，但不会误把 Mimo 请求打到 GLM runtime。
- 对话连续性通过 `sessionId` 冷恢复保留。

后续如果要支持“队列跟随当前运行 provider 直到队列清空”，需要单独设计队列项绑定 runtime fingerprint 的语义，不在第一版混入。

## 分阶段计划

### 阶段 1：只读诊断与测试基线

- 新增 provider fingerprint helper。
- 扩展 `/api/claude/models` 返回脱敏 provider 摘要。
- 扩展 `/api/claude/runtimes` 返回 runtime provider 摘要。
- trace 增加当前 provider fingerprint、selected model、request model、runtime reused。
- 补测试覆盖 GLM 配置、Mimo 配置、provider 指纹变化、敏感字段不泄漏。

验收：

- 不改变发送行为。
- 能在 debug/接口中看到 provider 指纹变化。
- API key/token 不出现在响应和 trace。

### 阶段 2：模型选择语义收敛

- 梳理 `resolveInitialClaudeModelId`，确保 provider 专属默认模型切换后回落到 `__default`。
- 明确 `resolveRequestModel`：`__default` 和 `kind: "default"` 永远不传 `model`。
- 发送前刷新模型列表快照，并基于最新快照计算请求模型。
- 补测试：GLM -> Mimo 后，默认选择不会继续请求 `glm-5.1`。

验收：

- UI 可展示当前默认模型变化。
- 默认发送不带旧 provider 模型。
- 自定义模型仍能显式作为 `--model` 发送。

### 阶段 3：runtime 复用加 provider 指纹

- `ClaudeRuntime` 保存 spawn 时 provider fingerprint。
- `isRuntimeCompatible(...)` 增加 fingerprint 比较。
- provider fingerprint 不一致时关闭空闲旧 runtime 并 spawn 新 runtime。
- trace 明确记录不复用原因，例如 `provider_changed`。
- 补后端测试：同 thread 默认模型请求，在 provider fingerprint 变化后不复用旧 runtime。

验收：

- 同 provider 连续追问仍复用热 runtime。
- GLM 切 Mimo 后，下一次请求不复用 GLM runtime。
- 运行中 runtime 不被强制关闭。

### 阶段 4：队列、审批、恢复边界

- 检查 `resolveQueuedPromptRunOptions`，确认队列项开始时会重新解析当前 provider/model。
- 检查 `request-user-input`、`approval-decision`、`guide` 等路径，避免它们绕过 provider 指纹或误开新 provider。
- 冷恢复 `sessionId` 时保留会话连续性；如果 provider 切换导致 resume 失败，显示可恢复错误。
- 补测试覆盖：
  - 运行中切 provider，不影响当前流。
  - 运行结束后排队消息使用新 provider，不复用旧 runtime。
  - 审批/问答暂停时不会因为模型刷新丢 pending 卡片。

验收：

- 队列不再把旧 provider 默认模型带到新 provider。
- 人工输入和审批流程不回归。
- 恢复失败有明确错误和 trace。

### 阶段 5：手工验证与收口

手工验证矩阵：

- GLM -> Mimo：默认模型发送成功，不出现 `glm-5.1` 参数错误。
- Mimo -> GLM：默认模型发送成功。
- 同 provider 连续追问：热 runtime 复用。
- 运行中切 provider：当前 run 正常结束，不中途换模型。
- 运行结束后再发：使用新 provider。
- 运行中排队后切 provider：队列启动时使用新 provider，旧 runtime 不复用。
- 设置页新聊天默认模型：`__default`、slot、自定义模型都按预期。
- 旧线程带 `glm-5.1` metadata：切 Mimo 后 Composer 回落到默认，不继续显式请求旧模型。

验证命令：

- `node --import tsx --test src/lib/claude-model-selection.test.ts`
- `node --import tsx --test server/lib/claude-models.test.ts`
- `node --import tsx --test server/lib/claude-service.spawn.test.ts`
- `node --import tsx --test src/lib/queued-prompts.test.ts`
- `npm run typecheck`

是否重启：

- 改到 Web 前端或 server 后，重启对应 dev 服务。
- 不涉及 Tauri 桌面壳时不构建桌面版；如果用户要求看桌面效果，再启动桌面版。

## 风险与防护

| 风险 | 防护 |
| --- | --- |
| provider fingerprint 泄漏敏感信息 | 只返回 hash、host、存在性，不返回 token/API key 原文 |
| provider 变化后误复用旧 runtime | runtime 兼容条件加入 fingerprint |
| 运行中被强制切换导致输出中断 | 只影响空闲 runtime 和下一次 run |
| 默认模型被保存成 provider 专属值 | thread metadata 保存选择语义，默认不保存具体模型 |
| 队列语义不清导致热会话错乱 | 第一版队列启动时重新解析，跨 provider 不承诺热复用 |
| 自定义模型被误判为旧 provider 模型 | 自定义模型作为用户显式选择保留 |
| 历史 transcript model 覆盖当前选择 | transcript model 只用于历史和统计，不作为当前 Composer 决策来源 |

## 需要确认的产品决策

推荐决策：

- provider 切换后，旧热进程不复用，但同一 thread 的 `sessionId` 继续用于冷恢复。
- 队列项启动时使用当前 provider，不强行沿用旧 provider。
- `__default` 始终表示不传 `--model`，UI 展示的当前默认模型只用于说明。

如果后续用户更重视“排队消息必须继续旧 provider 热会话”，需要另起一版队列设计，为队列项绑定 provider fingerprint 和 runtime continuation 语义。

## 完成定义

- 有 provider fingerprint helper 和脱敏测试。
- `/api/claude/models`、runtime status、trace 能解释 provider/model 决策。
- 默认模型在 GLM -> Mimo 后不再发送旧 `glm-5.1`。
- provider fingerprint 变化后空闲 runtime 不复用。
- 同 provider 连续追问仍复用 runtime。
- 运行中、队列、审批、问答、冷恢复路径均有测试或手工验证记录。
- `npm run typecheck` 通过。
