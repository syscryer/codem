# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

CodeM 是一个本地 Claude Code 包装器：浏览器 / Tauri 桌面壳调用本机 `claude` CLI,封装为多线程聊天 UI。后端做 CLI 桥接 + SQLite 持久化,前端复用稳定 stream event 契约渲染对话。

## 常用命令

```bash
npm run dev                  # 并行启动 backend(3001) + web(5173)
npm run dev:web              # 仅前端 vite
npm run dev:server           # 仅后端 tsx watch server/index.ts
npm run typecheck            # tsc -b,改完必跑的最低门禁
npm run build                # tsc -b && vite build && esbuild server -> dist-server
npm run desktop:dev          # Tauri 壳;若 3001/5173 未起会自动启动 npm run dev
npm run desktop:build        # 打包桌面应用(会先 npm run build)
```

测试用 Node 内置 runner + tsx loader,无 jest/vitest:

```bash
node --test --import tsx <path/to/file.test.ts>
node --test --import tsx tests/useAppSettings.test.ts server/lib/settings-store.test.ts
```

后端运行时 / 路由 / Claude CLI 桥接改动需要重启 dev server 后验证:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

本地数据库路径:`%LOCALAPPDATA%\CodeM\codem.sqlite`(Windows 项目)。

## 高层架构

### 三个独立单元
- `src/**` — React 19 + TS strict 前端
- `server/**` — Express 5 + node:sqlite 后端
- `src-tauri/**` — Rust + Tauri 2 桌面壳(Mica 透明窗、自定义装饰)

桌面壳通过 `dist-server` 内嵌 backend、`dist` 内嵌前端;dev 模式 Tauri 直接连 `http://127.0.0.1:5173`。

### 前端三大 hook(状态分层在 `.trellis/spec/frontend/state-management.md`)
- `useWorkspaceState` — projects / threads / panelState / 对话框 / toast / 历史持久化
- `useClaudeRun` — prompt / model / permissionMode / streaming runtime / queued prompts / pending approval+input
- `useAppSettings` — 设置面板状态(appearance / model / open-with / shortcuts / global prompt)

`App.tsx` 只做粘合,不要把请求和 streaming 写回组件层。共享类型在 `src/types.ts`,共享常量在 `src/constants.ts`(尤其 `permissionMenuModes` vs `permissionModes`)。`src/lib/conversation.ts` 是把 stream event / Claude JSONL transcript / SQLite stored history 三条路径折叠成统一 `turn.items` 的核心,改它必走 `.trellis/spec/frontend/conversation-rendering-model.md` 检查。

### 后端关键模块(`server/lib/`)
- `claude-service.ts` — Claude CLI 桥接,优先 stdin + stream-json 热会话 runtime;暂停 / 续跑 / 冷恢复都集中在这里
- `workspace-store.ts` — SQLite 持久化(projects / threads / messages / tool_calls / panel state / selection)
- `settings-store.ts` / `claude-global-prompt.ts` / `mcp-inspector.ts` / `skills-scanner.ts` / `usage-stats.ts` — 各设置子能力
- `slash-commands.ts` — 斜杠命令解析
- `open-with.ts` / `system-dialog.ts` / `git-clone.ts` — 系统集成

`server/index.ts` 仅保留 bootstrap + 路由 + 少量粘合;复杂逻辑放 `lib/`。

### 跨层契约(改之前必读 `.trellis/spec/backend/api-and-streaming.md`)
- `/api/claude/run` 的事件语义稳定,新增 event type 必须同步 `useClaudeRun`
- 修改现有 event 字段名要列出受影响分支:status / phase / delta / tool-start / tool-input-delta / tool-stop / tool-result / done / error
- 实时事件、JSONL transcript、SQLite 三条路径都要生成一致的 `turn.items` timeline

### 热会话与人工输入节点
- 热 runtime 复用条件:同 thread / workspace / permissionMode / model + runtime 可写
- 必须暂停 runtime 的 tool_use:`AskUserQuestion`、`RequestUserInput`、`ExitPlanMode`、`ApprovalRequest`,以及权限型 `tool_result is_error` / Claude Code 安全策略拦截
- 暂停期间保留可写 runtime,用户决策后优先写回同一运行;只有 runtime 不可写时才用 `sessionId` 冷恢复
- `ExitPlanMode` 映射 `approval-request`(`计划待确认`),不当普通工具错误展示;权限拦截结果转审批语义,不重复落红
- 已转成卡片的内部 tool_result 不应再以普通错误形式下发

### 权限 / 模型常量
- `permissionModes`(内部完整集合,兼容 Claude Code 历史值)
- `permissionMenuModes`(用户菜单只展示 `default / auto / bypassPermissions`)
- `DEFAULT_MODEL_VALUE = '__default'` 表示由后端读当前 provider 默认模型
- 运行中不要强制同步外部 provider 配置;切到非运行线程时才允许刷新模型列表

## 协作约定(来自 `AGENTS.md`)

- 修改前端 / 后端代码后,如果当前 dev 服务需要刷新才生效,主动重启并在回复里说明已重启
- 仅修改 Web 相关代码时不要顺手构建或重启桌面版;只有动到桌面壳、`src-tauri`、窗口材质、桌面专属样式时才主动启动桌面版
- 默认推送 Gitee 远端 `gitee` 的 `main` 分支,除非用户显式要求 GitHub
- 修复问题优先定位并修正真实数据来源 / 真实流程,不要用兜底掩盖;只有兼容旧数据 / 不可控外部输入时才加兜底,并说明原因

## 规范文档入口

进入较大改动前按需查阅:

- `.trellis/workflow.md` — 总入口
- `.trellis/spec/frontend/` — 目录结构、组件、状态管理、conversation rendering、质量门禁
- `.trellis/spec/backend/` — 目录结构、API & streaming、持久化、质量门禁
- `.trellis/spec/guides/` — cross-layer 思考、重构、复用
- `.trellis/tasks/` — 中大型工作项 PRD / 检查项沉淀
- `openspec/` — 行为提案与变更记录(改用户可见行为 / 跨层契约 / 多 provider / 持久化结构前先写)
- `docs/superpowers/plans/` — 已落地的实施计划存档
- `requirements.md` / `roadmap.md` — 详细需求与演进路线
