# Task: 优化 Agent Provider 渐进加载

## Background

进入“Agent 与模型 / 提供商”页面时，当前组件将 Provider Registry、Claude CLI 版本和三个 Provider 诊断放进同一个 `Promise.all`。页面在全部请求结束前只渲染一个 520px 的中央加载框，造成整块内容空白。实际测量 Registry 约 0.9 秒，CLI 版本和单个诊断约 0.3-0.5 秒，冷启动时等待会更明显。

## Objective

复用全局 Provider 状态并拆分 Registry 与 CLI 诊断加载，避免进入 Agent 与模型设置时整页空白

## Scope

In scope:

- 复用 `useAgentRun` 已加载的全局 Provider Registry，避免设置页重复请求同一列表。
- 为全局 Provider 状态提供显式刷新动作并传入设置页。
- 将 CLI 版本和各 Provider 诊断改为后台独立加载，失败只影响局部诊断信息。
- 初次 Registry 尚未返回时显示与真实布局一致的局部骨架，不再整块空白。
- 补充状态流和 UI 回归测试，并用真实浏览器验证加载过程。

Out of scope:

- 不修改 Agent 运行、模型目录或会话机制。
- 不修改 Provider Registry 和诊断接口协议。
- 不缓存诊断到本地持久化，避免展示过期安装/认证状态。

## Impact

- `src/hooks/useAgentRun.ts`
- `src/App.tsx`
- `src/components/settings/SettingsView.tsx`
- `src/components/settings/AgentModelSettings.tsx`
- `src/components/settings/AgentProviderSettings.tsx`
- `src/styles.css`
- Agent Provider 设置相关测试。

## Acceptance Criteria

- [x] 已有全局 Provider 数据时，进入设置页立即显示 Provider 列表，不再重复等待 Registry。
- [x] Registry 首次加载期间显示列表与详情骨架，而不是中央空白加载框。
- [x] CLI 版本和三个诊断异步补齐，不阻塞 Registry 渲染。
- [x] 单个诊断失败不会清空整个 Provider 页面，并有局部可见提示。
- [x] 手动刷新和实验 Agent 开关仍能刷新 Provider 可用状态。
- [x] TypeScript、相关前端测试和真实浏览器验证通过。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-provider-registry.test.ts`
- `git diff --check`
- Playwright 验证进入 Agent 与模型设置时的渐进加载和最终内容。

## Implementation Record
- 2026-07-14T17:43:37.297Z 复用 useAgentRun 的共享 Provider Registry；设置页改为 Registry 先渲染、CLI 与三项诊断后台 allSettled 加载，并加入列表/详情局部骨架和错误重试。

- 2026-07-14T17:17:39.021Z Task created by Trellis automation.

## Verification Results
- 2026-07-14T17:43:40.035Z `Playwright 延迟 Provider Registry 请求并检查渐进渲染`: pass (3 个列表骨架、1 个详情骨架、0 个中央阻塞加载器；完成后 4 个 Provider)

- 2026-07-14T17:43:39.148Z `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-provider-registry.test.ts`: pass (19/19)
- 2026-07-14T17:43:38.193Z `npm run typecheck`: pass

- `npm run typecheck`：通过。
- `node --import tsx --test src/lib/agent-provider-management-ui.test.ts src/lib/agent-provider-registry.test.ts`：19 项测试全部通过。
- `git diff --check`：通过，仅有工作区既有的 LF/CRLF 提示。
- Playwright 人为延迟 `/api/agents/providers` 15 秒：加载阶段显示 3 行列表骨架和 1 个详情骨架，中央阻塞加载器为 0；请求完成后显示 4 个 Provider 和真实详情。

## Completion Summary
- 2026-07-14T17:43:40.890Z Agent Provider 设置已改为共享 Registry 与渐进加载，避免初次进入整页空白，相关测试和真实浏览器验证通过。

- `useAgentRun` 统一持有并刷新 Provider Registry，设置页不再重复请求列表。
- Provider Registry、CLI 版本和原生诊断拆分为渐进加载；诊断使用 `Promise.allSettled` 独立更新并提供局部错误重试。
- 增加与真实列表、详情结构对齐的骨架状态及减少动态效果偏好支持。
- 保留手动刷新、默认 Agent 和实验 Agent 开关的原有行为。

## Follow-ups

- 如后端命令探测仍慢，再单独评估短 TTL 内存缓存；本轮不引入持久缓存。
