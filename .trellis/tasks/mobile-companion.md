# Task: 移动伴侣架构与移动端原型

## Background

CodeM 当前是 React + Tauri 2 + Rust/Axum 的桌面 Agent 工作台，Agent CLI、Git、项目文件和终端均运行在电脑本机。移动伴侣的目标不是移植完整桌面工作台，而是为手机提供一个受控的远程任务控制面：查看任务、创建任务、追问、停止、审批和回答 Agent 提问。

MindFS 仅作为移动交互、PWA、TLS、实时同步和远程访问模式的竞品参考。MindFS 使用 AGPL-3.0，CodeM 不复制其代码、样式、组件或设计资源，所有实现必须基于 CodeM 自身数据模型和 MIT 代码独立完成。

## Objective

完整实现并验证 CodeM 移动伴侣：独立 Apple 风格高玻璃化移动 UI、局域网安全连接与配对设备权限、脱敏移动 API、任务列表/详情/创建/追问/停止/审批/用户输入、实时断线同步、PWA 与通知基础，同时保持现有桌面端和 Agent 主流程不受影响。

## Scope

In scope:

- 调查现有桌面入口、workspace/thread/run/runtime、Agent 事件流、历史分页和人工输入接口。
- 定义移动端独立信息架构、路由、页面职责和共享边界。
- 定义独立 `/api/mobile/**` 安全网关、配对模型、设备权限和脱敏 DTO。
- 定义任务快照、SSE 重连游标、历史分页和写操作数据流。
- 输出任务首页、会话详情、新建任务、项目页和连接设置的移动线框原型。
- 视觉采用偏 Apple 的高玻璃化语言：大面积半透明材质、柔和高光、景深和分层；正文区保证对比度，避免多层 blur 叠加。
- 同时考虑浅色、深色、安全区、软键盘、44px 触控区和 reduced motion。

Out of scope:

- 不实现移动文件树、Git、Diff、终端、编辑器、浏览器工作台、插件或 MCP 管理。
- 不实现公网中继、App Store/Google Play 原生包或离线缓存任务正文。
- 不直接复用 MindFS 的 AGPL 代码、CSS、图标或视觉资产。

## Impact

- 前端新增独立 `src/mobile/**` 入口，复用 `src/types.ts`、`src/lib/agent-run-events.ts` 等协议中立逻辑，不把移动条件散落进桌面组件。
- 后端新增独立 `src-tauri/src/mobile_companion/**` 领域和独立 Router/Listener，不把现有 desktop Router 直接绑定到局域网地址。
- 持久化新增 paired devices、device permissions、pairing sessions 和 audit metadata，设备 Token 只保存哈希。
- 桌面设置增加“移动伴侣”启停、地址、配对码/二维码、设备管理和权限控制。

## Acceptance Criteria

- [x] 已明确移动伴侣与完整移动工作台的产品边界。
- [x] 已确认 MindFS 仅作为交互和架构参考，不复制 AGPL 实现。
- [x] 已定义独立移动信息架构和关键路由。
- [x] 已定义 thread/run/runtime 的移动任务聚合关系。
- [x] 已明确局域网 HTTPS 是完整 PWA 与安全设备凭据的前置条件。
- [x] 已定义第一阶段建议使用 REST 写操作 + SSE 事件流。
- [x] 完成 5 个关键移动页面的可交互线框原型。
- [x] 在线框中验证 320px、375px、430px 宽度无横向溢出。
- [x] 用户确认 Apple 风格高玻璃化视觉方向并授权按计划持续实现。
- [x] 独立移动入口不加载桌面工作台重型依赖。
- [x] 移动 Listener 默认关闭，开启后只暴露 `/api/mobile/**` 和移动静态资源。
- [x] 未配对设备不能读取任务数据，配对码短时单次有效。
- [x] 每台设备独立 Token、权限、撤销和最后访问时间可用。
- [x] 移动端可查看任务、历史分页和实时流式输出。
- [x] 移动端可创建、追问、guide、停止、审批和回答用户输入。
- [x] 断线后提示离线，恢复后按 cursor 重同步。
- [x] PWA manifest、基础离线壳、更新提示和非敏感缓存策略可用。
- [x] 桌面主流程、桌面 API 与 Agent 热会话无明显回归。
- [x] 自动化测试覆盖配对、撤销、权限、脱敏、重连和关键前端状态。

## Verification Commands

- 检查线框原型在 320px、375px、430px 下的布局和触控区域。
- 检查浅色、深色和 `prefers-reduced-motion` 表现。
- 检查所有页面不包含 Git、文件树、Diff、终端和编辑器入口。
- 检查架构未要求现有 desktop Router 监听 `0.0.0.0`。

## Implementation Record

- 2026-08-15T17:07:41.575Z 移动项目列表增加独立展开/收起：项目标题整行可点击，ChevronDown 表达状态；有最近会话默认展开，空项目展开显示暂无最近会话。
- 2026-07-18T20:03:08.805Z 完成最终验收复核：真实 HTTPS 配对与 Claude Code 任务再次通过，结果写入桌面 SQLite；Secure HttpOnly SameSite=Strict Cookie 生效，伪造 Origin=403，HTTP 明文访问拒绝。复核 PWA 通知点击、离线提示、恢复刷新和证书下载入口。

- 2026-07-18T19:32:05.540Z 补齐二维码配对：桌面生成短时单次配对码时同步生成包含 LAN 地址和 code 的二维码，移动连接页自动读取 query code；浏览器验证二维码 img 正常出现。移动流终态会追加到现有 SQLite turns，真实 PERSIST_OK 已验证 live 与持久化同时可读。
- 2026-07-18T19:26:11.500Z 修正真实 Agent 链路：桌面 run API 是 NDJSON 流而非 SSE；移动网关现在从响应头取得 runId、后台增量解析 NDJSON、聚合 text/thinking/tool/审批/用户输入事件，并在终态写回 SQLite history。校准 claude-code/openai-codex Provider ID、guide、reject 和两类用户输入 payload。

- 2026-07-18T19:03:29.251Z 完成移动伴侣第一轮真实实现：pathname 动态移动入口、Apple 高玻璃任务/项目/通知/设置/连接/新建/详情页面、20轮历史分页、贴底滚动、PWA shell；Rust 新增独立 0.0.0.0 LAN Listener（默认关闭）、一次性配对、设备 Token 哈希、view/send/stop/approve 权限、撤销、脱敏 bootstrap/history、任务创建与控制代理；桌面基础设置新增启停、地址、配对码和设备撤销。实测未配对 401，配对后读取 5 项目/26 任务。
- 2026-07-18T18:43:54.494Z 用户已确认移动线框并授权完整实现。任务范围从架构原型扩展为五阶段交付：独立移动 UI、安全网关与配对权限、任务实时链路与控制、PWA/断线恢复/通知、全量自动化与移动浏览器验收。

- 2026-07-18T18:39:25.351Z 完成 Apple 风格高玻璃化移动线框：任务首页、会话详情、新建任务、项目、连接设置。玻璃材质用于导航、状态卡、Composer 和 Bottom Sheet；长文本采用更高不透明度阅读层。原型仅使用 mock 数据，未接真实 API。
- 2026-07-18T18:32:26.426Z 完成移动伴侣范围、架构和安全边界草案：独立移动入口与 HTTPS 网关、REST+SSE、thread/run/runtime 聚合、每设备权限；确认 MindFS 仅作 AGPL 兼容范围内的交互参考。用户指定偏 Apple 的高玻璃化视觉方向，长文本阅读层保持高对比度。

- 2026-07-18T18:30:20.623Z Task created by Trellis automation.
- 2026-07-19：完成现状调查。现有 `AgentRunEvent`、审批/用户输入 API、热会话、事件缓存和 SQLite history 可作为移动层的数据源；当前 `main.tsx` 静态装配桌面 App，后续移动入口需要独立 lazy/multi-entry 边界。
- 2026-07-19：确定移动端不做 Git、文件树、Diff、终端和编辑器；MindFS 只参考底部拇指操作区、Bottom Sheet、软键盘适配、PWA/TLS 和实时同步思路。
- 2026-07-19：用户确认采用偏 Apple 的高玻璃化视觉方向。材质层负责导航、卡片、Composer 和 Bottom Sheet，长文本阅读面保持更高不透明度与稳定对比度。
- 2026-07-19：用户确认线框方向并授权按五阶段计划持续实现至最终验收，自行完成构建、自动化测试与移动浏览器验证。

## Architecture Draft

### Frontend boundary

```text
src/
  desktop-entry.tsx
  mobile-entry.tsx
  mobile/
    MobileApp.tsx
    MobileShell.tsx
    pages/
    components/
    hooks/
    lib/
  components/shared/
  lib/
```

- `/mobile/**` 使用独立入口或按 pathname 动态加载，手机不能下载 xterm、桌面工作台和大体积桌面组件。
- 共享层只放类型、事件归一化、Markdown 和纯业务 helper；移动页面结构、导航、Composer 和弹层独立维护。
- 移动端不直接复用完整 `ConversationTurn`，而是复用 `turn.items` 数据模型并实现移动渲染器。

### Mobile gateway boundary

```text
Desktop frontend -> existing loopback Router -> 127.0.0.1
Mobile browser   -> mobile HTTPS listener -> /api/mobile/**
                                      -> sanitized mobile services
                                      -> existing workspace/agent domains
```

- 移动 Listener 默认关闭，用户主动开启后才绑定局域网地址。
- 不合并或转发现有完整 desktop Router。
- 移动网关只持有最小服务能力，不提供系统文件、终端、配置密钥、原始 trace 或插件管理 API。

### Security model

- 局域网完整 PWA 使用 HTTPS；HTTP LAN 模式只能作为明确降级的开发/预览模式。
- 配对码使用安全随机数、短时有效、单次消费并限速。
- 配对成功后生成每设备独立凭据；服务端只保存 Token 哈希。
- Web 端优先使用 `HttpOnly + Secure + SameSite=Strict` 同源设备 Cookie。
- 设备权限分为 `view`、`send`、`stop`、`approve`，所有写路由逐项检查。
- Origin/Host/CORS 只作为附加保护，不能替代每个 HTTP/SSE 请求的设备认证。
- 撤销设备时立即使 Token 失效并关闭对应事件流。

### Task aggregate

```ts
type MobileTask = {
  threadId: string;
  activeRunId?: string;
  runtimePhase: 'idle' | 'starting' | 'running' | 'waiting' | 'stopped' | 'done' | 'error';
  pendingActions: MobilePendingAction[];
  latestEventCursor?: string;
};
```

- thread 是用户看到的任务/会话容器。
- run 是一次可停止、审批或回答的具体运行。
- runtime 是可跨轮复用的热会话进程，不能直接暴露成移动主实体。

### Realtime model

- 第一阶段使用 REST 写操作 + SSE 聚合事件流。
- SSE event 携带单调递增 cursor，支持 `Last-Event-ID`。
- 重连流程为：读取 bootstrap/sync 快照，再从 cursor 继续；cursor 失效时重新同步快照。
- 移动 API 输出稳定 Mobile DTO，不直接透传完整 desktop bootstrap、环境变量、绝对路径和原始 Agent 日志。

### Information architecture

```text
/mobile/connect
/mobile/tasks
/mobile/tasks/:threadId
/mobile/new
/mobile/projects
/mobile/notifications
/mobile/settings
```

- 底部导航：任务、项目、通知、设置。
- 新建任务为任务页主按钮或悬浮操作，不占用底部导航。
- 首次未配对只能访问连接页；撤销或过期后立即回到连接页。

## Verification Results

- 2026-08-15T17:07:41.996Z `npm run typecheck; node --import tsx --test src/mobile/*.test.ts src/mobile/hooks/*.test.ts; npm run build; 浏览器展开/收起验证`: 通过：25/25；m-xterm 展开显示空状态，mnl 收起后会话行移除，aria-expanded 正确。

- 2026-07-18T20:03:12.364Z `最终 HTTPS Claude Code 冒烟`: 通过：配对后读取 4 项目/16 任务，创建 claude-code 任务并收到指定 MOBILE_FINAL 标记，桌面 history 持久化 1 turn；恶意 Origin 403；Secure Cookie=true；HTTP 被拒绝。
- 2026-07-18T20:03:11.062Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust lib 176 passed、1 ignored（需登录 Grok）；Tauri main 13 passed；移动安全、配对、权限、脱敏测试均通过。

- 2026-07-18T20:03:09.832Z `npm run typecheck && npm run build`: 通过：TypeScript 无错误；生产构建成功，mobile CSS/MobileApp 与 desktop App 保持独立 chunk。
- 2026-07-18T19:32:06.956Z `二维码浏览器验证`: 通过：桌面基础设置生成配对码后出现唯一配对二维码，控制台无 error；移动 connect 可从 URL query 预填 code。

- 2026-07-18T19:32:06.460Z `npm audit --omit=dev --json`: 生产依赖 0 漏洞；npm 完整审计提示的 3 项仅来自开发依赖链。
- 2026-07-18T19:32:05.979Z `npm run package:doctor`: 通过：Doctor OK，Tauri resources 配置可识别。

- 2026-07-18T19:26:12.837Z `桌面开发模式与设置入口`: 通过：npm run desktop:dev 已运行；3001/5175 正常；基础设置可启用移动伴侣，启用后 0.0.0.0:3210 监听且 /mobile/tasks=200。
- 2026-07-18T19:26:12.398Z `真实 Claude Code 移动端端到端`: 通过：手机 API 配对后创建 claude-code 任务，9 次轮询内得到 Thinking + MOBILE_OK；随后 PERSIST_OK 同时在移动 live timeline 和桌面 SQLite history 中可读。

- 2026-07-18T19:26:11.965Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：Rust 174 passed、1 ignored；Tauri main 13 passed。
- 2026-07-18T19:03:31.050Z `浏览器 320/375/430 响应式`: 通过：三档 clientWidth=scrollWidth，无横向溢出；可见产品按钮修正后最小 44px；375px 真实截图观感正常，控制台无 error。

- 2026-07-18T19:03:30.565Z `移动网关 HTTP 冒烟`: 通过：独立 3211 端口提供 /mobile；未认证 bootstrap=401；一次性配对成功；认证后 bootstrap 返回 5 项目、26 任务。
- 2026-07-18T19:03:30.075Z `cargo test --manifest-path src-tauri/Cargo.toml mobile_companion --lib`: 通过：3/3，覆盖配对码格式、Token 哈希比较和路径摘要。

- 2026-07-18T19:03:29.643Z `npm run build`: 通过；移动 CSS 与 MobileApp 独立 chunk，桌面 App 仍独立加载。
- 2026-07-18T18:39:24.942Z `移动线框静态与浏览器验证`: 通过：fragment 无转义引号/字面 \\n，根节点唯一；任务、详情、新建、项目、连接 5 个页面可切换；320/375/430px 均 clientWidth=scrollWidth 无横向溢出；375px 可见产品按钮触控区域无低于 44x44px 的项。

## Completion Summary

- 2026-08-15T17:07:42.443Z 移动项目列表折叠交互已完成，改动仅在 src/mobile，桌面端不受影响。
- 2026-07-18T20:03:13.629Z 完成 CodeM 移动伴侣第一阶段：Apple 高玻璃独立移动 PWA、局域网 HTTPS 与一次性扫码配对、设备权限和撤销、脱敏移动 API、任务与会话实时控制、审批和用户输入、断线恢复、通知与桌面设置管理；完整构建、Rust 测试和真实 Claude Code 链路通过。

## Follow-ups

- 第一阶段保持局域网 PWA，不包含公网中继和原生应用商店安装包。
- 自签名局域网 HTTPS 首次使用需要在移动设备安装并信任 CodeM 生成的证书；连接页已提供证书下载入口。
