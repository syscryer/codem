# Task: 链接打开方式与本地网页预览

## Background

CodeM 已能把聊天 Markdown 中的本地文件链接打开到右侧文件工作台，也有独立的右侧浏览器，
但 HTTP/HTTPS 链接当前固定交给系统浏览器，正文链接没有自定义右键菜单，右侧浏览器也没有
“从对话打开指定 URL”的公共入口。用户因此无法选择默认行为，也无法像成熟 Agent 客户端一样
从链接临时切换打开目标。

同时，本地开发任务经常在回答中输出 `localhost`、`127.0.0.1` 或 `[::1]` 地址。仅把这些地址
留在正文里不利于反复打开和检查，需要在回答下方形成轻量“网页预览”产物卡片；普通互联网链接
则不应自动生成卡片，避免低价值堆叠和隐式网络访问。

## Objective

为聊天链接提供可配置默认打开目标、统一右键菜单，并为本地开发地址生成网页预览卡片

## Confirmed Decisions

- HTTP/HTTPS 链接默认使用外部浏览器打开。
- 设置页允许用户把默认行为切换为“右侧浏览器打开”。
- 链接右键菜单始终提供“在右侧浏览器打开”“在外部浏览器打开”“复制链接”，不受默认值影响。
- 首期自动生成网页预览卡片，但只识别本地开发地址：`localhost`、`127.0.0.1`、`[::1]`。
- Web 版不能使用原生右侧浏览器时回退外部浏览器；桌面版右侧浏览器打开失败时显示错误，不静默改走外部浏览器。

## Approaches Considered

### Selected: shared link action model

- 在纯 helper 中统一 URL 规范化、本地地址识别、去重和默认动作解析。
- Markdown 正文链接与网页预览卡片共用同一组动作和菜单语义。
- 由 `App` 暴露 `openWorkbenchBrowser(url)`，负责打开右工作台、切换到浏览器标签并创建或复用 URL 标签。
- 设置仍复用现有“打开方式”持久化链路，不引入第二套本地存储。

该方案改动面适中，但状态所有权清晰，后续来源卡片、工具输出链接也能复用。

### Rejected: renderer writes browser storage directly

让 Markdown renderer 直接读取设置并改写浏览器 localStorage，文件少、实现快，但无法可靠唤起已挂载的
右侧 WebView，也会把渲染、设置和工作台状态耦合在一起，不采用。

### Deferred: unified output/source drawer

把文件、审查、网页、来源和子 Agent 一次性整合成统一抽屉，体验更完整，但会扩大到导航、持久化和
多类产物状态机。本任务只建立可复用的链接动作与网页卡片基础，统一抽屉另立任务。

## Scope

In scope:

- 在“设置 > 打开方式”新增“网页链接默认打开方式”设置，选项为“外部浏览器”和“右侧浏览器”，默认外部浏览器。
- 应用设置类型、默认值、归一化、读取和保存兼容新字段；旧设置缺字段时自动使用外部浏览器。
- HTTP/HTTPS Markdown 链接左键遵循用户设置。
- HTTP/HTTPS Markdown 链接提供统一右键菜单：在右侧浏览器打开、在外部浏览器打开、复制链接。
- 右键菜单支持点击外部关闭、`Escape` 关闭，并使用现有 `PopoverPortal` / `workspace-menu` 视觉体系。
- 为 `App` 到 `RightWorkbench` 建立显式浏览器打开请求；同一规范化 URL 优先复用已有标签，否则创建新标签并激活。
- 从单个 assistant turn 的可见 Markdown 文本中识别本地 HTTP/HTTPS 地址，规范化、去重后按首次出现顺序生成网页预览卡片。
- 网页预览卡片主点击遵循默认设置，并提供与正文链接一致的打开方式菜单。
- 桌面端和 Web 端都保留外部浏览器路径；Web 端选择右侧浏览器时明确回退外部浏览器。
- 使用现有主题变量和卡片/菜单风格，检查浅色、深色、桌面和 Web 布局。

Out of scope:

- 不自动请求网页，不抓取标题、favicon、截图、摘要或 Open Graph 信息。
- 不为普通互联网链接自动生成网页预览卡片。
- 不支持 `file:`、`javascript:`、`data:`、自定义协议或带用户名/密码的 URL。
- 不在首期把本地文件链接菜单扩展为 IDE、终端、复制文件内容等完整 CC 风格二级菜单。
- 不新建统一“输出 / 子智能体 / 来源”抽屉，不改变现有文件、审查和浏览器工作台的信息架构。
- 不让网页卡片触发网络预加载，不把 URL 内容写入历史、debug/raw events 或 trace。

## Interaction And Data Flow

1. 设置通过现有 `AppSettings.openWith` 链路加载；缺省值为 `external`。
2. Markdown renderer 只负责分类链接并把点击/右键动作上抛，不直接操作工作台状态。
3. 左键根据当前设置选择 `openExternalUrl(url)` 或 `openWorkbenchBrowser(url)`；右键菜单动作显式覆盖默认值。
4. `App` 接收右侧浏览器请求，打开右工作台、切换到 `browser`，并把一次性 URL 请求传给 `RightWorkbench`。
5. `RightWorkbench` 规范化 URL；命中已有标签时激活，未命中时在最多 8 个标签的既有规则内创建标签并导航。
6. 每个 assistant turn 从最终可见文本/Markdown 来源提取本地开发 URL，按规范化 URL 去重并渲染卡片；不额外发起网络请求。
7. 右侧浏览器拒绝 URL 或打开失败时通过现有 toast 展示可读错误；复制失败也明确提示。

## Compatibility, Security And Privacy

- 新设置字段必须可选归一化，确保旧版本设置和测试 fixture 不报错。
- 外部打开继续只接受 HTTP/HTTPS；右侧浏览器继续拒绝账号密码和非 HTTP(S) 协议。
- 本地地址识别必须基于解析后的 hostname 精确匹配，不能把 `localhost.example.com`、`127.0.0.1.example.com` 识别为本地。
- URL 文本只用于显示、复制和用户触发的导航，不做后台探测；因此不会因回答中出现链接而产生额外网络访问。
- 卡片 URL 从已经展示给用户的 assistant 内容派生，不新增持久化字段；刷新后由历史正文稳定重建。
- 普通链接、页内锚点和本地文件链接的既有行为不能回归。

## Impact

- Types/settings：`src/types.ts`、`src/hooks/useAppSettings.ts`、设置 API 对应前后端归一化/持久化测试。
- Settings UI：`src/components/settings/OpenWithSettings.tsx` 及现有设置样式。
- Link actions：`src/lib/markdown-link.tsx` 与新增/扩展的纯 URL helper、定向测试。
- Conversation UI：`src/components/ConversationTurn.tsx`，承载链接右键菜单和本地网页预览卡片。
- App bridge：`src/App.tsx`、`src/components/ConversationPane.tsx` 等现有 props 链，提供明确业务动作。
- Browser workbench：`src/components/RightWorkbench.tsx`、`src/lib/workbench-browser.ts` 及 UI/helper 测试。
- Styles：`src/styles.css` 或实际归属的现有会话/工作台样式文件，复用主题变量。

## Acceptance Criteria

- [ ] 新安装和旧设置数据都默认用外部浏览器打开 HTTP/HTTPS 链接。
- [ ] 用户可在“打开方式”设置中切换默认目标，重启应用后设置仍保留。
- [ ] 正文链接左键遵循默认设置；链接右键始终显示右侧浏览器、外部浏览器、复制链接三项。
- [ ] 右键菜单可通过外部点击和 `Escape` 关闭，位置不溢出窗口，样式与现有菜单一致。
- [ ] “在右侧浏览器打开”会展开右工作台并激活浏览器；相同规范化 URL 复用标签，不重复堆叠。
- [ ] 当右侧浏览器已有 8 个标签时遵循既有上限策略，不能破坏现有浏览器状态。
- [ ] Web 版默认外部打开；即使设置为右侧浏览器也安全回退外部打开，不出现空白工作台。
- [ ] 仅包含本地开发 URL 的 assistant turn 在回答下方显示去重后的网页预览卡片，并保持首次出现顺序。
- [ ] 普通互联网链接、伪本地域名、带凭据 URL、非 HTTP(S) 协议不生成网页预览卡片。
- [ ] 网页预览卡片不发起抓取或预加载；主点击和菜单行为与正文链接一致。
- [ ] 链接打开失败、URL 被拒绝和复制失败都有可读反馈，不触发主 WebView 重载。
- [ ] 本地文件链接、页内锚点、输出文件卡片、变更审查和现有右侧浏览器能力无回归。
- [ ] 长回答包含大量普通链接时不生成额外卡片；大量本地重复 URL 的提取与渲染没有明显卡顿。

## Verification Commands

- `node --import tsx --test src/lib/markdown-link.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`
- 新增设置归一化、链接动作、本地 URL 提取和网页卡片交互的定向 Node tests。
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 桌面真实验收：切换两种默认设置，分别左键和右键打开本地/外部 URL，验证标签复用、复制和重启持久化。
- Web 真实验收：将默认值设为右侧浏览器后点击链接，确认回退到新浏览器标签且主页面不重载。
- 视觉验收：浅色/深色、窄窗口/常规窗口下检查正文链接菜单和网页预览卡片，无重叠、溢出和主题割裂。

## Implementation Record
- 2026-08-01T08:25:19.395Z 已确认采用共享链接动作模型：默认外部浏览器，设置可切换右侧浏览器；正文链接与本地网页预览卡片共用打开和右键菜单行为，普通互联网链接不自动生成卡片，也不做网络预取。

- 2026-08-01T08:22:31.351Z Task created by Trellis automation.

## Verification Results

## Completion Summary

## Follow-ups

- 统一文件、审查、网页、来源和子 Agent 的输出抽屉另立任务评估。
- 本地文件链接的 IDE / 终端 / 复制内容二级菜单另立任务，不与本期链接行为混合。
- 网页标题、favicon、截图或健康状态检测只有在明确隐私策略和缓存边界后再讨论。
