# Task: 移动端 PWA 伴侣第一期

## Background

用户希望提供 CodeM 移动端，定位是桌面端的"伴侣"：

- 聊天窗口（聊天日志）直接复用桌面端实现，其他管理功能调用桌面端现有 API。
- 不允许影响桌面端既有行为与全局状态。
- 第一版只做 PWA，只在局域网使用；用户网络环境为 Tailscale（网络层已加密，第一版用 HTTP 即可）。
- 功能范围只做"聊天管理 + 聊天"。

现状盘点（2026-08-15）：

- 前端 React 19 + Vite，Tauri 耦合集中在约 12 个桥接文件（`isTauriRuntime()` 判断），Web 模式下走同源 `/api`。
- 后端 Rust + Axum，`run_blocking_with_config` 固定绑定 `127.0.0.1`（`src-tauri/src/backend.rs`），CORS 只放行 localhost / tauri origin。
- `runtime_auth` Bearer token 中间件已存在，但仅在 Agent Mux Runtime（环境变量 token）模式下启用；桌面/Web 日常模式无鉴权。
- 后端当前不伺服前端静态资源（Web 开发模式由 Vite 伺服，桌面模式由 Tauri 内嵌）。
- Agent CLI 只能在后端所在机器执行，移动端必然是远程瘦客户端；架构上"前端只是后端客户端"已经成立。

## Objective

在局域网（Tailscale）内通过 PWA 远程复用桌面端 CodeM 的聊天管理与聊天功能，不影响桌面端既有行为

## Scope

In scope:

- 后端"远程访问"模式（默认关闭，显式开启）：
  - 设置持久化到 SQLite；开启后监听地址从 `127.0.0.1` 放开为 `0.0.0.0`（或指定地址）。
  - Axum 伺服前端构建产物（同源访问，天然绕开 CORS 白名单问题）。
  - 设备配对：桌面端生成一次性配对码（含 `http://<主机地址>:<端口>/pair?code=...` 二维码与短码），移动端用一次性码换取长效设备 token；设备列表持久化、可撤销。
  - 远程模式下所有 `/api` 强制 Bearer 设备 token 鉴权（复用/扩展 `runtime_auth` 思路）；`/pair`、identity、health 等配对前置端点除外。
  - 桌面设置页新增"远程访问"管理区块：开关、风险提示、设备列表、撤销、配对码展示。
- 移动端前端（与桌面端同一套代码，按视口/运行环境切换布局）：
  - 移动布局：抽屉式项目/会话列表 + 聊天主区 + 底部输入栏，处理软键盘与 safe-area。
  - 复用现有聊天 timeline、消息/工具调用渲染、流式输出；审批、Plan 确认、AI 提问卡片必须可用（属于聊天运行时的一环，缺了远程会话会卡死）。
  - 支持切换项目/会话、查看历史、续聊发送、停止运行。
  - 断线重连与会话状态恢复（后端已有持久化，补客户端重连与恢复逻辑）。
  - PWA：manifest、图标、最小 service worker（只缓存 app shell，绝不缓存 `/api`）。
  - 移动端常用设置（本地存储，不写回桌面）：连接管理（主机地址、配对状态、解除配对）、主题、字体大小。
- "不影响桌面端"原则：移动端对桌面全局配置只读；模型、权限模式等运行参数随请求传递，不持久化为全局默认值；移动端不改变桌面当前选中的项目/会话/渠道。

Out of scope:

- 工作台移动适配（文件树、Diff 审查、终端、浏览器预览）。
- Agent 安装/更新、Provider/渠道管理、工作流编排、Agent Mux、使用统计页。
- 推送通知、原生壳（Capacitor）、应用商店分发。
- 公网直连与内置 HTTPS/TLS（用户经 Tailscale，网络层已加密；公网场景后续引导反向代理）。
- 多端同会话并发冲突的显式仲裁（复用现有 per-run / 队列机制）。

## Impact

- `src-tauri/src/backend.rs` 及可能新增的 `remote_access.rs`：监听地址配置、静态资源伺服、设备 token 鉴权中间件、配对与设备管理 API、设置项。
- SQLite：新增远程访问设置与已配对设备表；不改既有表结构。
- `src/**`：移动布局切换、移动端 API 客户端（token 注入、非 Tauri 远程模式 baseUrl 解析）、配对/连接 UI、移动设置页、聊天卡片触控适配。
- 桌面设置页：新增"远程访问"区块。
- `public/`：PWA manifest、图标。
- 不改动：Agent 桥接协议、事件流格式、既有 API 语义（仅新增）。

## Acceptance Criteria

- [ ] 远程访问默认关闭；关闭时后端与前端行为与当前版本完全一致（仍绑定 127.0.0.1、无静态伺服、无新 UI 入口的布局变化）。
- [ ] 开启后，手机经局域网/Tailscale 访问 `http://<主机>:<端口>` 可加载前端，完成扫码/输码配对并换取设备 token。
- [ ] 配对后可见项目与会话列表；选择会话可查看历史并续聊，流式输出正常。
- [ ] 审批 / Plan 确认 / AI 提问卡片在移动端可正常响应；运行中可停止。
- [ ] 未配对或已被撤销的设备访问受保护 API 返回 401。
- [ ] 移动端发送消息、切换模型/权限模式不改变桌面端的当前选择与全局设置。
- [ ] 手机锁屏或断网重连后，进行中的会话可恢复且事件不丢。
- [ ] PWA 可添加到主屏；断开连接时给出明确错误提示，不白屏。
- [ ] 桌面端（Tauri 与 Web dev）无回归：typecheck 与既有测试全绿。

## Verification Commands

- `npm run typecheck`
- `node --import tsx --test src/**/*.test.ts`（相关子集）
- `cargo test --manifest-path src-tauri/Cargo.toml`
- 手动验收：桌面开启远程访问 → 手机浏览器配对 → 续聊 / 审批 / 停止 / 断网重连 → 桌面端回归检查。

## Implementation Record
- 2026-08-17T09:42:31.236Z 需求纠正：用户核心目标是安装版也支持其他机器访问完整桌面 Web，不接受仅 desktop:dev/Vite 5173 的方案。已撤销上一轮未验证的 Vite 外部监听与开发地址 UI 改动。后续方案必须基于安装包内置 Rust/Axum 服务，并先确认完整桌面能力范围与鉴权边界。

- 2026-08-17T09:39:01.298Z 用户确认采用方案 2：仅在 npm run desktop:dev 时开放并展示桌面 Web 开发地址；安装版不使用 5173 且不展示该地址。实现范围限定为 Vite 开发监听与 MobileCompanionSettings 地址展示，复用当前实际 web 端口和 LAN/Tailscale 主机地址，不新增安装版远程 API 或鉴权。桌面开发地址仅依赖受信任网络/Tailscale ACL，设置页需明确风险。
- 2026-08-17T09:11:18.945Z 定位远程 /mobile 返回桌面端根因：3210 由 Rust mobile_companion 直接提供 dist，而桌面开发模式只启动 Vite HMR，不会刷新 dist；当前 dist 最后构建于 2026-08-15，仍引用旧 index-Q5W8L1La.js。Playwright 已复现 /mobile 加载完整桌面工作台。

- 2026-08-15T15:36:15.983Z 用 ui-ux-pro-max 对移动原型做了一轮 UI/UX 审核并完成优化。审核依据：技能优先级表（触控/无障碍/动效/布局）+ pro-rules 交付前清单 + 设计系统基线查询。修复项：1) 触控目标全部提到 ≥44px（图标按钮 36→44、审批/回答按钮 38→44、模型/权限胶囊、分段按钮、色板改 44 点击区+::before 绘制圆点、开关改 44 点击区+内部轨道）；2) 发现并修复小屏真 bug：pair-wrap/timeline 纵向 flex 滚动容器子元素默认 flex-shrink 压缩，667px 高度下配对按钮被压到 21px，已加 flex-shrink:0；3) 无障碍：图标按钮补 aria-label（发送/停止动态切换）、配对表单 label 关联 input、focus-visible 焦点环、toast aria-live、modal role=dialog；4) 对比度：新增 --warning-text 令牌（浅色 #b45309），审批卡/审查卡/等待徽标文字不再用 3.3:1 的 #d97706；5) 交互反馈：touch-action manipulation、-webkit-tap-highlight-color、按压过渡 150ms、屏幕切换 200ms 转场；6) 滚动隔离 overscroll-behavior:contain；7) prefers-reduced-motion 适配；8) 真机横屏（coarse pointer + 矮高度）进入全屏模式。复验：375x667 四屏触控目标 0 违例、无横向溢出、配对-聊天-停止链路回归通过、色板/开关视觉正常、无控制台错误。
- 2026-08-15T15:10:40.558Z 原型修复：说明面板里 <ul> 被误闭合为 </div>，导致浏览器提前关闭 .stage 容器，手机壳被挤出视口外（用户任何窗口宽度都只能看到说明面板，按钮'点不动'）。已改为正确的 </ul>，并补充窄窗口（≤900px）隐藏说明面板、stage flex-wrap 兜底。复验：720px 手机壳居中完整可见、1200px 说明面板+手机并排、390px 满屏，截图视觉确认配对页渲染正常。教训：DOM 断言必须包含可见性/位置校验，不能只查元素存在。

- 2026-08-15T14:51:58.444Z 移动端第一期原型完成：docs/prototypes/mobile-pwa/index.html，单文件可交互原型，四屏（配对/会话列表/聊天/设置）。样式对齐桌面端主题变量（浅/深色、强调色、字号）；交互已验证：扫码/输码配对→会话列表→进入聊天→发送模拟运行（流式输出、工具卡、计划卡、权限审批三按钮、产出审查卡）→停止运行→设置切主题/强调色/字号→解除配对回配对页。DOM 级验证：四屏无横向溢出（深色+大字号条件）、真机 390px 视口全屏且说明面板隐藏、无控制台报错。验证截图已清理。
- 2026-08-15T14:33:51.995Z 移动端方案定稿：PWA 伴侣形态，局域网+Tailscale+HTTP，仅聊天管理与聊天；后端新增默认关闭的远程访问模式（0.0.0.0 绑定、Axum 伺服前端 dist 实现同源免 CORS、一次性配对码换设备 token、可撤销）；移动端复用桌面聊天组件按视口切换布局；移动端只读桌面全局配置，运行参数随请求传递不写回。分三阶段：后端远程模式 → 移动主链路 UI → 审批/重连/PWA/设置补全。

- 2026-08-15T14:32:45.515Z Task created by Trellis automation.
- 2026-08-15 需求对齐完成：PWA、局域网 + Tailscale + HTTP、只做聊天管理与聊天；定位为桌面端"伴侣"，不影响桌面端。技术方案选定"方案 A：响应式 Web + PWA + 后端远程访问模式"，Capacitor 原生壳留作后续按需增量。
- 2026-08-15 设计定稿（分三阶段实现）：
  1. 阶段 1 后端远程访问模式：设置开关、绑定地址放开、静态伺服、设备 token 鉴权、配对/撤销 API、桌面设置页"远程访问"区块。
  2. 阶段 2 移动端主链路 UI：移动布局骨架、项目/会话抽屉、聊天 timeline 复用与流式、发送/停止、底部输入栏。
  3. 阶段 3 补全：审批/Plan/AI 提问卡片触控细节、断线重连恢复、PWA manifest + service worker、移动设置页（连接管理、主题、字体）。

## Verification Results
- 2026-08-17T09:34:22.843Z `Playwright 精确访问 http://100.103.172.16:3210/mobile（无查询参数）`: 通过：仍为 CodeM Mobile 登录页；浏览器控制台无错误，仅 Chromium 密码框 form 提示；桌面进程响应正常，5173 与 0.0.0.0:3210 持续监听。

- 2026-08-17T09:25:54.787Z `Playwright 访问 http://100.103.172.16:3210/mobile?codem=6，并在 390x844 视口 snapshot + screenshot`: 通过：页面显示 CodeM Mobile 登录页、账号/密码与登录按钮；不再出现文件/编辑菜单、桌面侧栏、Git 或桌面工作台。截图 output/playwright/mobile-remote-fixed.png。
- 2026-08-17T09:25:42.164Z `npm run build`: 通过：TypeScript project build 与 Vite production build 成功；dist/index.html 更新为 index-lJHq994i.js，并生成 MobileApp-CFixQnv0.js、mobile-BrJ8FtCF.css 独立移动产物。

- 2026-08-15T15:36:16.410Z `375x667 视口四屏触控目标审计 + 交互回归 + 控制台检查`: 全部通过：触控目标 0 违例、pair 按钮 316x48、发送/停止 aria 正确切换、无控制台错误
- 2026-08-15T14:51:58.820Z `浏览器加载原型并用 DOM 断言走完整交互链路`: 配对/会话/聊天模拟运行/审批/设置/解除配对全部通过，无控制台错误，无布局溢出

## Completion Summary

## Follow-ups

- 工作台移动适配（文件树、Diff、终端、浏览器预览）另立任务。
- Capacitor 原生壳与推送通知（方案 B）按需启动。
- 公网访问场景的安全加固（内置 TLS 或反向代理指引）。
