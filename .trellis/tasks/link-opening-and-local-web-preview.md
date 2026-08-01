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
7. 右侧浏览器拒绝 URL 或打开失败时通过工作台错误区或现有 toast 展示可读错误；复制失败也明确提示。

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

- [x] 新安装和旧设置数据都默认用外部浏览器打开 HTTP/HTTPS 链接。
- [x] 用户可在“打开方式”设置中切换默认目标，重启应用后设置仍保留。
- [x] 正文链接左键遵循默认设置；链接右键始终显示右侧浏览器、外部浏览器、复制链接三项。
- [x] 右键菜单可通过外部点击和 `Escape` 关闭，位置不溢出窗口，样式与现有菜单一致。
- [x] “在右侧浏览器打开”会展开右工作台并激活浏览器；相同规范化 URL 复用标签，不重复堆叠。
- [x] 当右侧浏览器已有 8 个标签时遵循既有上限策略，不能破坏现有浏览器状态。
- [x] Web 版默认外部打开；即使设置为右侧浏览器也安全回退外部打开，不出现空白工作台。
- [x] 仅包含本地开发 URL 的 assistant turn 在回答下方显示去重后的网页预览卡片，并保持首次出现顺序。
- [x] 普通互联网链接、伪本地域名、带凭据 URL、非 HTTP(S) 协议不生成网页预览卡片。
- [x] 网页预览卡片不发起抓取或预加载；主点击和菜单行为与正文链接一致。
- [x] 链接打开失败、URL 被拒绝和复制失败都有可读反馈，不触发主 WebView 重载。
- [x] 本地文件链接、页内锚点、输出文件卡片、变更审查和现有右侧浏览器能力无回归。
- [x] 长回答包含大量普通链接时不生成额外卡片；大量本地重复 URL 的提取与渲染没有明显卡顿。

## Verification Commands

- `node --import tsx --test src/lib/markdown-link.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`
- 新增设置归一化、链接动作、本地 URL 提取和网页卡片交互的定向 Node tests。
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 桌面真实验收：切换两种默认设置，分别左键和右键打开本地/外部 URL，验证标签复用、复制和重启持久化。
- Web 真实验收：将默认值设为右侧浏览器后点击链接，确认回退到新浏览器标签且主页面不重载。
- 视觉验收：浅色/深色、窄窗口/常规窗口下检查正文链接菜单和网页预览卡片，无重叠、溢出和主题割裂。

## Design Addendum: Markdown File Link Context Menu

### Goal

聊天正文中的 Markdown 本地文件链接在保留左键右侧预览行为的同时，接入与文件产物卡片一致的右键操作。用户不需要先找到下方产物卡片，也能直接从正文完成预览、外部打开、定位和复制完整路径。

### Confirmed Interaction

- 左键：维持现状，解析文件路径后在右侧工作台预览。
- 右键：阻止浏览器原生菜单，显示四项固定动作：`在右侧预览`、`用默认应用打开`、`在文件浏览器中显示`、`复制完整路径`。
- 菜单通过鼠标坐标定位，支持外部点击和 `Escape` 关闭；执行任一动作后关闭。
- HTTP(S) 链接继续使用网页链接三项菜单；页内锚点和不安全协议不接入文件菜单。

### Architecture And Data Flow

1. `renderMarkdownLink` 只负责分类和派发：本地文件右键上抛原始路径与坐标，不在 renderer 内解析工作目录或执行系统动作。
2. `MarkdownMessage` 使用当前 turn 的 workspace 和现有 `resolveWorkbenchPreviewFilePath` 解析相对路径；绝对路径保持不变。
3. 新增共享文件动作菜单组件，正文文件链接和 `ConversationOutputFileCard` 共同使用同一动作顺序、图标、关闭行为和 `workspace-menu` 样式。
4. 右侧预览复用 `buildConversationOutputFilePreviewRequest`；默认应用和文件浏览器定位复用现有 `onOpenOutputPath`、`onRevealOutputPath` 调用链；复制写入解析后的完整路径。
5. `ConversationTurnView`、`renderAssistantItem` 和 `MarkdownMessage` 只透传已有文件动作回调，不新增后端 API，也不读取文件内容。

### Compatibility, Security And Failure Handling

- 只处理 `classifyMarkdownLink` 已识别为 `local-file` 的路径，不扩大可接受协议范围。
- 路径解析沿用当前左键预览逻辑，支持相对路径、Windows 绝对路径、中文和空格；不猜测不存在文件的替代位置。
- 默认应用打开和文件浏览器定位继续由现有受控后端能力执行，失败沿用当前 toast 反馈。
- Web 版保持现有宿主机文件动作语义；不新增浏览器文件系统权限，也不把本地路径发送到外部服务。
- 历史消息数据结构不变，不需要迁移或重新持久化。

### Acceptance Criteria

- 正文相对文件链接右键显示四项固定动作，复制结果是基于 turn workspace 解析后的完整路径。
- Windows 绝对路径、中文路径和含空格路径保持原样并可执行四项动作。
- 左键文件预览、网页链接左键/右键、页内锚点和文件产物卡片行为无回归。
- 正文文件链接与文件产物卡片菜单使用同一共享组件，不保留两份易漂移的菜单实现。
- 菜单在桌面/Web、浅色/深色及窄窗口下不越界、不遮挡正文，键盘焦点与 `Escape` 关闭正常。
- 自动化测试覆盖分类派发、路径解析、菜单结构/关闭、四项动作接线和既有链接回归；完成后进行真实桌面/Web 手工验收。

## Implementation Record
- 2026-08-01T16:35:41.747Z 修复聊天正文中文空格文件链接：新增仅处理本地文件目标的 remark AST 插件，接入会话 Markdown，并对 ReactMarkdown 百分号编码路径做安全解码；网页、不安全协议和行内代码保持原行为

- 2026-08-01T10:14:06.467Z 用户手工验收发现裸空格中文 Markdown 文件链接未生成链接节点；已定位为 CommonMark 解析限制，并确认合法空格链接还会把 href 百分号编码，需要同时修复宽松解析和本地路径解码
- 2026-08-01T09:41:52.057Z 完成正文文件链接与文件产物卡片共享四项文件动作菜单；定向测试 18/18、typecheck 通过

- 2026-08-01T09:37:01.842Z 完成 Markdown 本地文件链接右键事件派发契约；定向测试 10/10 通过
- 2026-08-01T09:32:57.778Z 完成正文文件链接右键菜单实施计划，按 renderer 派发、共享文件菜单、会话接线和真实验收四个 TDD 切片执行

- 2026-08-01T09:25:51.129Z 确认正文 Markdown 文件链接复用文件产物四项右键菜单：右侧预览、默认应用打开、文件浏览器显示、复制完整路径
- 2026-08-01T09:00:23.844Z 完成本地开发 URL 的安全提取、去重和无预加载网页预览卡片

- 2026-08-01T08:57:09.953Z 完成网页链接默认动作、右键三项菜单、复制失败反馈和 Web 外部回退
- 2026-08-01T08:46:55.805Z Task 1 完成：新增 webLinkOpenTarget，默认 external；TypeScript/Rust 双端归一化兼容旧设置，设置页可切换外部/右侧浏览器。前端 12/12、Rust 1/1、typecheck 通过；因重叠文件已有未提交修改，未做阶段提交。

- 2026-08-01T08:41:28.716Z 已完成实施计划：按设置契约、浏览器请求与标签复用、链接动作菜单、本地网页卡片、桌面/Web 全量验收五个 TDD 切片执行；计划已自检规格覆盖、占位符和类型一致性。
- 2026-08-01T08:25:19.395Z 已确认采用共享链接动作模型：默认外部浏览器，设置可切换右侧浏览器；正文链接与本地网页预览卡片共用打开和右键菜单行为，普通互联网链接不自动生成卡片，也不做网络预取。

- 2026-08-01T08:22:31.351Z Task created by Trellis automation.

## Verification Results
- 2026-08-01T16:51:47.717Z `桌面链接、网页预览与文件右键菜单手工验收`: 用户确认通过；中文和空格文件链接已正确渲染，左键预览、四项右键菜单、默认应用打开、文件浏览器定位与完整路径复制符合预期

- 2026-08-01T16:35:44.536Z `git diff --check`: 通过，无空白错误；仅显示工作区既有 LF/CRLF 提示
- 2026-08-01T16:35:43.856Z `npm run build`: 通过；仅有既有 Vite 动态导入和 chunk size 提示

- 2026-08-01T16:35:43.135Z `npm run typecheck`: 通过，0 个 TypeScript 错误
- 2026-08-01T16:35:42.423Z `node --import tsx --test src/lib/markdown-link.test.ts src/lib/markdown-local-file-links.test.ts src/lib/web-link-action-menu.test.ts src/lib/file-action-menu.test.ts src/lib/conversation-output-file-interactions.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`: 41/41 通过，0 failed；中文空格文件链接、路径解码、网页与文件菜单相关回归均通过

## Completion Summary
- 2026-08-01T16:51:48.392Z 完成网页链接默认打开设置、正文网页三项右键菜单、本地开发 URL 预览卡片，以及正文文件链接与文件产物共享四项操作；补齐中文空格 Markdown 文件链接解析和路径解码，自动化与用户桌面验收均通过

## Follow-ups

- 统一文件、审查、网页、来源和子 Agent 的输出抽屉另立任务评估。
- 本地文件链接的 IDE / 终端 / 复制内容二级菜单另立任务，不与本期链接行为混合。
- 网页标题、favicon、截图或健康状态检测只有在明确隐私策略和缓存边界后再讨论。

# 链接打开方式与本地网页预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天中的 HTTP/HTTPS 链接增加可配置默认打开目标和统一右键菜单，把 assistant 回复中的本地开发地址提取为轻量网页预览卡片，并让正文文件链接复用文件产物的四项右键菜单。

**Architecture:** `AppSettings.openWith.webLinkOpenTarget` 是唯一持久化设置；`App` 负责把默认动作解析成外部浏览器或右侧浏览器请求。URL 识别、提取和浏览器标签复用保持为纯函数，`ConversationTurn` 只负责渲染，`RightWorkbench` 只消费一次性打开请求并维护浏览器标签状态。Markdown renderer 只派发本地文件路径和右键坐标，`MarkdownMessage` 解析 workspace 相对路径，正文文件链接与文件产物卡片共同使用 `FileActionMenu` 执行四项文件动作。

**Tech Stack:** React 19、TypeScript strict mode、React Markdown、Lucide、Tauri 2、Rust/Axum、Node test runner。

---

## File Map

- `src/types.ts`：新增网页链接默认目标和右侧浏览器打开请求类型。
- `src/lib/settings-api.ts`：前端默认值和旧设置归一化。
- `src-tauri/src/backend.rs`：后端设置归一化、默认值和持久化兼容。
- `src/components/settings/OpenWithSettings.tsx`：新增网页链接默认行为分段控件。
- `src/lib/workbench-browser.ts`：规范化 URL 后复用、占用空标签、创建标签或报告上限。
- `src/components/RightWorkbench.tsx`：消费一次性 URL 请求并显示可读错误。
- `src/lib/markdown-link.tsx`：把 HTTP(S) 左键和右键事件交给上层动作，不持有工作台状态。
- `src/components/WebLinkActionMenu.tsx`：正文链接和网页卡片共用的三项菜单。
- `src/components/FileActionMenu.tsx`：正文文件链接和文件产物卡片共用的四项菜单。
- `src/lib/conversation-web-previews.ts`：从可见 assistant 文本中提取、校验和去重本地开发 URL。
- `src/components/ConversationWebPreviewCard.tsx`：轻量网页预览卡片，不发起网络请求。
- `src/components/ConversationTurn.tsx`、`src/components/ConversationPane.tsx`、`src/App.tsx`：传递稳定业务动作并完成页面集成。
- `src/styles.css`：复用主题变量补齐菜单和网页卡片样式。

### Task 1: 设置契约、默认值与持久化

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/settings-api.ts`
- Modify: `src/lib/settings-api.test.ts`
- Modify: `src/components/settings/OpenWithSettings.tsx`
- Create: `src/lib/open-with-settings-ui.test.ts`
- Modify: `src-tauri/src/backend.rs`

- [ ] **Step 1: 写前端设置归一化失败测试**

在 `src/lib/settings-api.test.ts` 导入 `defaultOpenWithSettings` 和 `normalizeOpenWithSettings`，增加：

```ts
test('网页链接默认使用外部浏览器并只保留受支持的设置值', () => {
  assert.equal(defaultOpenWithSettings.webLinkOpenTarget, 'external');
  assert.equal(normalizeOpenWithSettings({}).webLinkOpenTarget, 'external');
  assert.equal(
    normalizeOpenWithSettings({ selectedTargetId: 'vscode', customTargets: [], webLinkOpenTarget: 'workbench' })
      .webLinkOpenTarget,
    'workbench',
  );
  assert.equal(
    normalizeOpenWithSettings({ selectedTargetId: 'vscode', customTargets: [], webLinkOpenTarget: 'invalid' })
      .webLinkOpenTarget,
    'external',
  );
});
```

- [ ] **Step 2: 运行前端测试确认 RED**

Run: `node --import tsx --test src/lib/settings-api.test.ts`

Expected: FAIL，提示 `webLinkOpenTarget` 不存在或返回 `undefined`。

- [ ] **Step 3: 扩展 TypeScript 设置类型和归一化**

在 `src/types.ts` 和 `src/lib/settings-api.ts` 使用同一字段名：

```ts
export type WebLinkOpenTarget = 'external' | 'workbench';

export type OpenWithSettings = {
  selectedTargetId: string;
  customTargets: OpenAppTarget[];
  webLinkOpenTarget: WebLinkOpenTarget;
};
```

```ts
export const defaultOpenWithSettings: OpenWithSettings = {
  selectedTargetId: 'vscode',
  customTargets: [],
  webLinkOpenTarget: 'external',
};

export function normalizeOpenWithSettings(openWith: unknown): OpenWithSettings {
  const record = isRecord(openWith) ? openWith : {};
  if ('target' in record) {
    return {
      ...normalizeLegacyOpenWithSettings(record),
      webLinkOpenTarget: 'external',
    };
  }
  return {
    selectedTargetId: normalizeOpenTargetId(record.selectedTargetId) || defaultOpenWithSettings.selectedTargetId,
    customTargets: normalizeOpenAppTargets(record.customTargets),
    webLinkOpenTarget: normalizeOneOf(record.webLinkOpenTarget, ['external', 'workbench'], 'external'),
  };
}
```

所有 `normalizeLegacyOpenWithSettings` 返回值也必须包含 `webLinkOpenTarget: 'external'`，避免类型断裂。

- [ ] **Step 4: 写 Rust 归一化失败测试**

把 `normalize_open_with_settings` 加入 `backend.rs` 测试模块的 `use super::{...}`，增加：

```rust
#[test]
fn open_with_settings_default_web_links_to_external_browser() {
    assert_eq!(
        normalize_open_with_settings(None)["webLinkOpenTarget"],
        json!("external")
    );
    assert_eq!(
        normalize_open_with_settings(Some(&json!({
            "selectedTargetId": "vscode",
            "customTargets": [],
            "webLinkOpenTarget": "workbench"
        })))["webLinkOpenTarget"],
        json!("workbench")
    );
    assert_eq!(
        normalize_open_with_settings(Some(&json!({
            "webLinkOpenTarget": "invalid"
        })))["webLinkOpenTarget"],
        json!("external")
    );
}
```

- [ ] **Step 5: 运行 Rust 测试确认 RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml open_with_settings_default_web_links_to_external_browser`

Expected: FAIL，因为 Rust 归一化结果没有 `webLinkOpenTarget`。

- [ ] **Step 6: 补齐 Rust 默认值、当前设置和旧设置归一化**

`normalize_open_with_settings` 的结果和 `default_app_settings().openWith` 都加入：

```rust
"webLinkOpenTarget": enum_setting(record, "webLinkOpenTarget", &["external", "workbench"], "external")
```

旧格式迁移的每个返回对象固定加入：

```rust
"webLinkOpenTarget": "external"
```

- [ ] **Step 7: 增加设置页交互并验证源码接线**

在 `OpenWithSettings.tsx` 使用现有 `SettingsRow` 和 `SegmentedControl`：

```tsx
<SettingsRow icon={Globe2} title="网页链接" description="控制聊天中的网页链接默认打开位置">
  <SegmentedControl
    value={openWith.webLinkOpenTarget}
    options={[
      { value: 'external', label: '外部浏览器', icon: ExternalLink },
      { value: 'workbench', label: '右侧浏览器', icon: PanelRightOpen },
    ]}
    onChange={(webLinkOpenTarget) => void onUpdateOpenWith({ webLinkOpenTarget })}
  />
</SettingsRow>
```

`src/lib/open-with-settings-ui.test.ts` 读取组件源码并断言存在两个选项、默认字段和 `onUpdateOpenWith({ webLinkOpenTarget })`。

- [ ] **Step 8: 运行设置测试并记录 Trellis**

Run: `node --import tsx --test src/lib/settings-api.test.ts src/lib/open-with-settings-ui.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml open_with_settings_default_web_links_to_external_browser`

Expected: 全部 PASS。

Record: `npm run trellis -- record "完成网页链接默认打开方式的前后端设置契约、旧设置兼容和设置页控件"`

- [ ] **Step 9: 形成设置切片提交**

只暂存本任务新增的设置 hunks；若文件含既有未提交修改，先检查差异并使用选择性暂存，不能带入无关内容。

Commit: `feat: 增加网页链接默认打开设置`

### Task 2: 右侧浏览器打开请求与标签复用

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/workbench-browser.ts`
- Modify: `src/lib/workbench-browser.test.ts`
- Modify: `src/lib/workbench-browser-ui.test.ts`
- Modify: `src/components/RightWorkbench.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 为标签复用和上限写失败测试**

在 `workbench-browser.test.ts` 增加 `openWorkbenchBrowserUrl` 用例：

```ts
test('external requests reuse matching or empty browser tabs before creating a tab', () => {
  const empty = { tabs: [{ id: 'browser-tab-empty', title: '新标签页', url: '' }], activeTabId: 'browser-tab-empty' };
  const opened = openWorkbenchBrowserUrl(empty, 'http://localhost:5173');
  assert.equal(opened.outcome, 'opened');
  assert.equal(opened.state.tabs.length, 1);
  assert.equal(opened.state.tabs[0].url, 'http://localhost:5173/');

  const reused = openWorkbenchBrowserUrl(opened.state, 'http://localhost:5173/');
  assert.equal(reused.outcome, 'reused');
  assert.equal(reused.state.tabs.length, 1);
  assert.equal(reused.state.activeTabId, opened.state.tabs[0].id);
});

test('external requests preserve state when the browser tab limit is reached', () => {
  const tabs = Array.from({ length: MAX_WORKBENCH_BROWSER_TABS }, (_, index) => ({
    id: `browser-tab-${index}`,
    title: `Tab ${index}`,
    url: `https://example.com/${index}`,
  }));
  const current = { tabs, activeTabId: tabs[0].id };
  const result = openWorkbenchBrowserUrl(current, 'http://127.0.0.1:3000');
  assert.equal(result.outcome, 'limit-reached');
  assert.deepEqual(result.state, current);
});
```

- [ ] **Step 2: 运行浏览器 helper 测试确认 RED**

Run: `node --import tsx --test src/lib/workbench-browser.test.ts`

Expected: FAIL，提示 `openWorkbenchBrowserUrl` 未导出。

- [ ] **Step 3: 实现纯标签状态转换**

在 `workbench-browser.ts` 新增：

```ts
export type WorkbenchBrowserOpenOutcome = 'opened' | 'reused' | 'limit-reached';

export function openWorkbenchBrowserUrl(
  state: WorkbenchBrowserState,
  value: string,
): { state: WorkbenchBrowserState; outcome: WorkbenchBrowserOpenOutcome; url: string } {
  const url = normalizeWorkbenchBrowserInput(value);
  const matchingTab = state.tabs.find((tab) => tab.url === url);
  if (matchingTab) {
    return { state: { ...state, activeTabId: matchingTab.id }, outcome: 'reused', url };
  }

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (activeTab && !activeTab.url) {
    return {
      state: {
        tabs: state.tabs.map((tab) => tab.id === activeTab.id
          ? { ...tab, url, title: browserTitleFromUrl(url) }
          : tab),
        activeTabId: activeTab.id,
      },
      outcome: 'opened',
      url,
    };
  }

  if (state.tabs.length >= MAX_WORKBENCH_BROWSER_TABS) {
    return { state, outcome: 'limit-reached', url };
  }

  const tab = createWorkbenchBrowserTab(url);
  return {
    state: { tabs: [...state.tabs, tab], activeTabId: tab.id },
    outcome: 'opened',
    url,
  };
}
```

- [ ] **Step 4: 定义一次性请求并接入 RightWorkbench**

在 `src/types.ts` 新增：

```ts
export type WorkbenchBrowserOpenRequest = {
  id: string;
  url: string;
};
```

`RightWorkbenchProps` 增加 `browserOpenRequest: WorkbenchBrowserOpenRequest | null` 并传给 `WorkbenchBrowserShell`。浏览器组件新增 effect：

```ts
useEffect(() => {
  if (!browserOpenRequest) return;
  try {
    const result = openWorkbenchBrowserUrl(browserStateRef.current, browserOpenRequest.url);
    if (result.outcome === 'limit-reached') {
      setError(`最多只能打开 ${MAX_WORKBENCH_BROWSER_TABS} 个浏览器标签页`);
      return;
    }
    setError('');
    setBrowserState(result.state);
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }
}, [browserOpenRequest]);
```

同步维护 `browserStateRef.current = browserState`，避免 effect 读取旧闭包。

- [ ] **Step 5: 在 App 建立桌面打开入口**

新增 request state 和显式方法：

```ts
const [browserOpenRequest, setBrowserOpenRequest] = useState<WorkbenchBrowserOpenRequest | null>(null);

function openWorkbenchBrowser(url: string) {
  setBrowserOpenRequest({ id: crypto.randomUUID(), url });
  setRightWorkbenchOpen(true);
  setRightWorkbenchTab('browser');
}
```

将 `browserOpenRequest` 传给 `RightWorkbench`。Web 回退在 Task 3 的统一动作入口处理，不能让 Web 版展开空白右侧浏览器。

- [ ] **Step 6: 补 UI 接线断言并运行测试**

在 `workbench-browser-ui.test.ts` 断言 `browserOpenRequest` 从 `RightWorkbench` 传入 `MemoWorkbenchBrowserShell`、effect 调用 `openWorkbenchBrowserUrl`、达到上限时显示错误。

Run: `node --import tsx --test src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts`

Expected: 全部 PASS。

Record: `npm run trellis -- record "完成从 App 打开指定 URL 到右侧浏览器的请求链路，并支持标签复用和上限错误"`

- [ ] **Step 7: 形成浏览器请求切片提交**

Commit: `feat: 支持从会话打开右侧浏览器标签`

### Task 3: 统一链接动作与右键菜单

**Files:**
- Modify: `src/lib/markdown-link.tsx`
- Modify: `src/lib/markdown-link.test.ts`
- Create: `src/components/WebLinkActionMenu.tsx`
- Create: `src/lib/web-link-action-menu.test.ts`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/components/ConversationPane.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 写 Markdown 链接动作失败测试**

扩展 `markdown-link.test.ts`，直接检查返回元素的事件 props：

```ts
test('web links delegate left click and context menu actions', () => {
  const opened: string[] = [];
  const contextMenus: Array<{ url: string; x: number; y: number }> = [];
  const element = renderMarkdownLink({
    href: 'https://example.com/docs',
    children: 'Docs',
    onOpenWebUrl: (url) => opened.push(url),
    onOpenWebContextMenu: (target) => contextMenus.push(target),
  });
  const click = { preventDefault() {} } as React.MouseEvent<HTMLAnchorElement>;
  const contextMenu = { preventDefault() {}, clientX: 12, clientY: 24 } as React.MouseEvent<HTMLAnchorElement>;
  const props = element.props as {
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
    onContextMenu: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  };
  props.onClick(click);
  props.onContextMenu(contextMenu);
  assert.deepEqual(opened, ['https://example.com/docs']);
  assert.deepEqual(contextMenus, [{ url: 'https://example.com/docs', x: 12, y: 24 }]);
});
```

测试回调签名包含 `clientX/clientY`，并断言坐标被原样传递。

- [ ] **Step 2: 运行 Markdown 测试确认 RED**

Run: `node --import tsx --test src/lib/markdown-link.test.ts`

Expected: FAIL，因为 renderer 尚未接受网页动作回调，也没有 `onContextMenu`。

- [ ] **Step 3: 让 renderer 只负责派发链接动作**

`MarkdownLinkProps` 新增：

```ts
onOpenWebUrl?: (url: string) => void;
onOpenWebContextMenu?: (target: { url: string; x: number; y: number }) => void;
```

HTTP(S) 左键调用 `onOpenWebUrl?.(target.url)`；没有回调时继续 `void openExternalUrl(target.url)`。右键只对 HTTP(S) 阻止默认菜单，并上抛 `{ url, x: event.clientX, y: event.clientY }`；本地文件和页内锚点保持既有行为。

- [ ] **Step 4: 新建共享动作菜单组件**

`WebLinkActionMenu.tsx` 接口固定为：

```ts
export type WebLinkMenuTarget = { url: string; x: number; y: number };

type WebLinkActionMenuProps = {
  target: WebLinkMenuTarget | null;
  onClose: () => void;
  onOpen: (url: string, target: WebLinkOpenTarget) => void | Promise<void>;
  onCopy: (url: string) => void | Promise<void>;
};
```

组件使用 `PopoverPortal` 的 `virtualAnchor` 和现有 `workspace-menu` 样式，按钮固定为：

```tsx
<button role="menuitem" onClick={() => run(() => onOpen(target.url, 'workbench'))}>
  <PanelRightOpen size={14} /><span>在右侧浏览器打开</span>
</button>
<button role="menuitem" onClick={() => run(() => onOpen(target.url, 'external'))}>
  <ExternalLink size={14} /><span>在外部浏览器打开</span>
</button>
<div className="workspace-menu-divider" role="separator" />
<button role="menuitem" onClick={() => run(() => onCopy(target.url))}>
  <Copy size={14} /><span>复制链接</span>
</button>
```

`useOutsideDismiss` 处理外部点击，effect 处理 `Escape`；每个动作在执行后关闭菜单。

- [ ] **Step 5: 写菜单结构和关闭行为测试**

`web-link-action-menu.test.ts` 读取组件源码，断言三个唯一菜单项、`PopoverPortal`、`useOutsideDismiss`、`Escape` 和动作执行后 `onClose()`。测试不得依赖浏览器网络。

- [ ] **Step 6: 在会话渲染链路传递两个稳定动作**

`ConversationPaneProps` 和 `ConversationTurnView` 增加：

```ts
onOpenWebLink: (url: string, target?: WebLinkOpenTarget) => void | Promise<void>;
onCopyWebLink: (url: string) => void | Promise<void>;
```

`ConversationPane` 用现有 `useLatestCallback` 稳定这两个回调。`MarkdownMessage` 持有 `WebLinkMenuTarget | null`，左键调用 `onOpenWebLink(url)`，右键设置 target，并在 Markdown 正文旁渲染 `WebLinkActionMenu`。

- [ ] **Step 7: 在 App 解析默认行为和 Web 回退**

统一入口必须只有一处：

```ts
async function handleOpenWebLink(url: string, requestedTarget?: WebLinkOpenTarget) {
  const target = requestedTarget ?? openWith.webLinkOpenTarget;
  if (target === 'workbench' && isTauriRuntime()) {
    openWorkbenchBrowser(url);
    return;
  }
  const opened = await openExternalUrl(url);
  if (!opened) {
    showToast('打开网页链接失败', 'error');
  }
}

async function handleCopyWebLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    showToast('复制链接失败，请重试或手动复制。', 'error');
  }
}
```

将 `openExternalUrl` 调整为 `Promise<boolean>`：URL 非 HTTP(S)、Tauri invoke 失败或 Web popup 被拦截返回 `false`，成功返回 `true`。Web 环境请求 `workbench` 时自动走外部浏览器，不展开右工作台。

- [ ] **Step 8: 运行链接与接线测试**

Run: `node --import tsx --test src/lib/markdown-link.test.ts src/lib/web-link-action-menu.test.ts`

Expected: 全部 PASS，原本的本地文件、锚点和不安全协议用例仍通过。

Record: `npm run trellis -- record "完成网页链接默认动作、右键三项菜单、复制失败反馈和 Web 外部回退"`

- [ ] **Step 9: 形成链接动作切片提交**

Commit: `feat: 增加聊天链接右键打开菜单`

### Task 4: 本地网页预览提取与卡片

**Files:**
- Create: `src/lib/conversation-web-previews.ts`
- Create: `src/lib/conversation-web-previews.test.ts`
- Create: `src/components/ConversationWebPreviewCard.tsx`
- Create: `src/lib/conversation-web-preview-ui.test.ts`
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 写本地 URL 提取失败测试**

`conversation-web-previews.test.ts` 覆盖规范化、顺序、去重和拒绝项：

```ts
test('extractLocalWebPreviewUrls keeps only exact loopback http urls in first-seen order', () => {
  assert.deepEqual(
    extractLocalWebPreviewUrls([
      '启动于 http://localhost:5173，API: http://127.0.0.1:3000/。',
      '[重复](http://localhost:5173/) https://example.com http://localhost.example.com',
      'IPv6: http://[::1]:8080/docs。',
    ]),
    [
      'http://localhost:5173/',
      'http://127.0.0.1:3000/',
      'http://[::1]:8080/docs',
    ],
  );
});

test('extractLocalWebPreviewUrls rejects credentials unsafe schemes and punctuation-only candidates', () => {
  assert.deepEqual(
    extractLocalWebPreviewUrls([
      'https://user:pass@localhost:5173 file://localhost/a javascript:alert(1)',
    ]),
    [],
  );
});
```

- [ ] **Step 2: 运行提取测试确认 RED**

Run: `node --import tsx --test src/lib/conversation-web-previews.test.ts`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现纯提取函数**

实现只扫描 `http://` / `https://` 候选，再交给 `URL` 校验：

```ts
const WEB_URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、]+$/u;

export function extractLocalWebPreviewUrls(contents: readonly string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const content of contents) {
    for (const match of content.matchAll(WEB_URL_CANDIDATE)) {
      const candidate = trimMarkdownUrlCandidate(match[0]);
      try {
        const url = new URL(candidate);
        const hostname = url.hostname.toLowerCase();
        const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
        if (!local || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) continue;
        const normalized = url.toString();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      } catch {
        continue;
      }
    }
  }
  return urls;
}

function trimMarkdownUrlCandidate(value: string) {
  let result = value.replace(TRAILING_PUNCTUATION, '');
  while (result.endsWith(')') && count(result, ')') > count(result, '(')) result = result.slice(0, -1);
  while (result.endsWith(']') && count(result, ']') > count(result, '[')) result = result.slice(0, -1);
  while (result.endsWith('}') && count(result, '}') > count(result, '{')) result = result.slice(0, -1);
  return result;
}

function count(value: string, token: string) {
  return Array.from(value).filter((character) => character === token).length;
}
```

- [ ] **Step 4: 新建轻量网页卡片组件**

`ConversationWebPreviewCard.tsx` 只接收数据和动作，不读取设置、不 fetch：

```ts
type ConversationWebPreviewCardProps = {
  urls: string[];
  onOpen: (url: string, target?: WebLinkOpenTarget) => void | Promise<void>;
  onCopy: (url: string) => void | Promise<void>;
};
```

每个 URL 是独立 `article`，固定高度的图标区、标题 `网页预览`、hostname/port 和完整 URL。主按钮调用 `onOpen(url)`；`MoreHorizontal` 打开同一个 `WebLinkActionMenu`，卡片本身不嵌套另一张卡片。

- [ ] **Step 5: 在单个 turn 中派生卡片数据**

`ConversationTurnViewComponent` 增加：

```ts
const webPreviewUrls = useMemo(
  () => extractLocalWebPreviewUrls(
    turn.items.filter((item) => item.type === 'text').map((item) => item.text),
  ),
  [turn.items],
);
```

在 narrative 内容之后、文件产物卡片之前渲染：

```tsx
{webPreviewUrls.length > 0 ? (
  <ConversationWebPreviewCard
    urls={webPreviewUrls}
    onOpen={onOpenWebLink}
    onCopy={onCopyWebLink}
  />
) : null}
```

- [ ] **Step 6: 补卡片 UI 和无网络副作用测试**

`conversation-web-preview-ui.test.ts` 读取组件及 `ConversationTurn.tsx`，断言：

- 卡片使用 `Globe2`、`MoreHorizontal` 和 `WebLinkActionMenu`。
- 主点击调用未指定 target 的默认动作。
- 菜单显式传 `workbench` / `external`。
- 组件源码不包含 `fetch(`、`Image`、截图或 favicon 请求。
- 仅从 `item.type === 'text'` 派生，不读取 thinking、tool input、raw events。

- [ ] **Step 7: 增加主题化样式并运行定向测试**

样式使用 `var(--panel)`、`var(--border)`、`var(--text)`、`var(--muted)`、`var(--accent)` 等现有变量；卡片圆角不超过 `8px`，URL 使用省略显示但保留 `title`，窄窗口允许操作区换行。

Run: `node --import tsx --test src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/markdown-link.test.ts`

Expected: 全部 PASS。

Record: `npm run trellis -- record "完成本地开发 URL 的安全提取、去重和无预加载网页预览卡片"`

- [ ] **Step 8: 形成网页卡片切片提交**

Commit: `feat: 展示本地网页预览卡片`

### Task 5: 全量回归、桌面/Web 验收与收尾

**Files:**
- Modify: `.trellis/tasks/link-opening-and-local-web-preview.md`
- Modify: `.trellis/workspace/sessions/session-20260801-082231-kz6b-link-opening-and-local-web-preview.md`

- [ ] **Step 1: 运行全部相关 Node 测试**

Run:

```powershell
node --import tsx --test src/lib/settings-api.test.ts src/lib/open-with-settings-ui.test.ts src/lib/markdown-link.test.ts src/lib/web-link-action-menu.test.ts src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-output-file-interactions.test.ts
```

Expected: 0 failed。

- [ ] **Step 2: 运行前后端质量门禁**

Run: `npm run typecheck`

Run: `npm run build`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml open_with_settings_default_web_links_to_external_browser`

Run: `git diff --check`

Expected: 全部成功；Vite 既有 chunk size 提示可记录，但不能把编译或测试失败当作提示忽略。

- [ ] **Step 3: 重启桌面开发模式并做真实交互验收**

因为修改了桌面右侧 WebView 和设置持久化，停止旧桌面开发进程后启动：

Run: `npm run desktop:dev`

在真实会话中输出 `http://localhost:5173`、`http://127.0.0.1:3000`、`http://[::1]:8080`、`https://example.com` 和重复本地 URL，验收：

1. 默认设置下正文左键和卡片主点击均打开外部浏览器。
2. 改为右侧浏览器后，本地/外部 HTTP(S) 左键在右侧打开，重复 URL 复用标签。
3. 两种设置下右键菜单始终有三项，复制成功静默、失败显示错误。
4. 只有三个精确 loopback 地址生成卡片，普通域名和伪本地域名不生成。
5. 点击链接不改变 CodeM 主页面 URL、不触发主 WebView 重载。
6. 达到 8 个标签后显示上限错误，已有标签和页面不丢失。
7. 重启 CodeM 后默认行为设置仍保留。

- [ ] **Step 4: 做 Web 回退和响应式视觉验收**

仅启动 Web 模式时使用当前可用端口，设置为“右侧浏览器”后点击链接，确认实际调用外部浏览器且右侧空白工作台不展开。用常规桌面宽度和窄窗口分别检查浅色/深色主题，菜单不越界，URL 不遮挡按钮，卡片不嵌套。

- [ ] **Step 5: 写回实际验证结果并完成 Trellis session**

按实际结果逐条登记，不合并或省略失败项：

```powershell
npm run trellis -- verify "node --import tsx --test src/lib/settings-api.test.ts src/lib/open-with-settings-ui.test.ts src/lib/markdown-link.test.ts src/lib/web-link-action-menu.test.ts src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-output-file-interactions.test.ts" --result "全部通过，0 failed；记录实际通过数量"
npm run trellis -- verify "npm run typecheck" --result "通过，0 个 TypeScript 错误"
npm run trellis -- verify "npm run build" --result "通过；仅有已确认的 Vite chunk size 或动态导入提示"
npm run trellis -- verify "cargo fmt --manifest-path src-tauri/Cargo.toml --check" --result "通过，Rust 格式无差异"
npm run trellis -- verify "cargo test --manifest-path src-tauri/Cargo.toml open_with_settings_default_web_links_to_external_browser" --result "通过，1 passed，0 failed"
npm run trellis -- verify "git diff --check" --result "通过，无空白错误"
npm run trellis -- verify "桌面链接打开与本地网页预览验收" --result "两种默认行为、网页三项右键菜单、loopback 卡片、标签复用与上限、设置持久化均通过，0 项失败"
npm run trellis -- verify "Web 链接回退与响应式视觉验收" --result "右侧浏览器设置正确回退外部打开，主页面未重载；浅色/深色及常规/窄窗口均通过，0 项失败"
```

所有验收通过后执行：

```powershell
npm run trellis -- complete --summary "完成网页链接默认打开设置、统一右键菜单、右侧浏览器标签复用和本地网页预览卡片；桌面/Web、设置持久化及相关回归均已验证"
```

- [ ] **Step 6: 最终差异审查和交付提交**

检查 `git status --short` 和逐文件 diff，确认没有覆盖用户已有修改、没有构建产物或临时文件进入提交。只暂存本任务 hunks。

Commit: `feat: 完善网页链接打开与本地预览体验`

### Task 6: 本地文件链接右键派发契约

**Files:**
- Modify: `src/lib/markdown-link.tsx`
- Modify: `src/lib/markdown-link.test.ts`

- [ ] **Step 1: 写本地文件右键失败测试**

在 `markdown-link.test.ts` 增加真实事件派发测试，明确本地文件右键只返回原始路径和鼠标坐标：

```ts
test('local file links delegate context menu actions without changing left click behavior', () => {
  const opened: string[] = [];
  const contextMenus: Array<{ path: string; x: number; y: number }> = [];
  const element = renderMarkdownLink({
    href: 'docs/中文 验收.md#result',
    children: '打开文档',
    onOpenLocalFile: (path) => opened.push(path),
    onOpenLocalFileContextMenu: (target) => contextMenus.push(target),
  });
  const props = element.props as {
    onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  };

  props.onClick({ preventDefault() {} } as ReactMouseEvent<HTMLAnchorElement>);
  props.onContextMenu({
    preventDefault() {},
    clientX: 18,
    clientY: 32,
  } as ReactMouseEvent<HTMLAnchorElement>);

  assert.deepEqual(opened, ['docs/中文 验收.md']);
  assert.deepEqual(contextMenus, [{ path: 'docs/中文 验收.md', x: 18, y: 32 }]);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test src/lib/markdown-link.test.ts`

Expected: FAIL，提示 `onOpenLocalFileContextMenu` 不属于 renderer props 或 `onContextMenu` 不存在。

- [ ] **Step 3: 实现 renderer 事件派发**

在 `markdown-link.tsx` 定义并使用明确类型：

```ts
export type MarkdownLocalFileMenuTarget = {
  path: string;
  x: number;
  y: number;
};

type MarkdownLinkProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'title'> & {
  children?: ReactNode;
  onOpenLocalFile?: (path: string) => void;
  onOpenLocalFileContextMenu?: (target: MarkdownLocalFileMenuTarget) => void;
  onOpenWebUrl?: (url: string) => void;
  onOpenWebContextMenu?: (target: { url: string; x: number; y: number }) => void;
};
```

`onContextMenu` 按链接分类分别派发，不改变左键分支：

```ts
onContextMenu: target.kind === 'external' && onOpenWebContextMenu
  ? (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onOpenWebContextMenu({ url: target.url, x: event.clientX, y: event.clientY });
    }
  : target.kind === 'local-file' && onOpenLocalFileContextMenu
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onOpenLocalFileContextMenu({
          path: target.path,
          x: event.clientX,
          y: event.clientY,
        });
      }
    : undefined,
```

- [ ] **Step 4: 运行 renderer 测试确认 GREEN**

Run: `node --import tsx --test src/lib/markdown-link.test.ts`

Expected: 全部 PASS，HTTP(S)、锚点、不安全协议和左键文件预览用例无回归。

Record: `npm run trellis -- record "完成 Markdown 本地文件链接右键事件派发契约"`

### Task 7: 共享文件动作菜单与会话接线

**Files:**
- Create: `src/components/FileActionMenu.tsx`
- Create: `src/lib/file-action-menu.test.ts`
- Modify: `src/lib/conversation-output-file-interactions.test.ts`
- Modify: `src/components/ConversationTurn.tsx`

- [ ] **Step 1: 写共享菜单和接线失败测试**

新建 `file-action-menu.test.ts`，在组件尚不存在时得到 RED，并约束菜单只能有一份：

```ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL('../components/FileActionMenu.tsx', import.meta.url);
const componentSource = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';
const turnSource = readFileSync(new URL('../components/ConversationTurn.tsx', import.meta.url), 'utf8');

test('文件动作菜单提供四项固定动作和统一关闭行为', () => {
  assert.ok(componentSource, 'FileActionMenu.tsx should exist');
  assert.equal((componentSource.match(/在右侧预览/g) ?? []).length, 1);
  assert.equal((componentSource.match(/用默认应用打开/g) ?? []).length, 1);
  assert.equal((componentSource.match(/在文件浏览器中显示/g) ?? []).length, 1);
  assert.equal((componentSource.match(/复制完整路径/g) ?? []).length, 1);
  assert.match(componentSource, /PopoverPortal/);
  assert.match(componentSource, /useOutsideDismiss/);
  assert.match(componentSource, /event\.key === 'Escape'/);
  assert.match(componentSource, /finally[\s\S]*onClose\(\)/);
});

test('正文文件链接和文件产物卡片共同使用 FileActionMenu', () => {
  assert.match(turnSource, /import \{ FileActionMenu/);
  assert.ok((turnSource.match(/<FileActionMenu/g) ?? []).length >= 2);
  assert.match(turnSource, /onOpenLocalFileContextMenu/);
  assert.doesNotMatch(turnSource, /<span>在文件浏览器打开<\/span>/);
});
```

扩展 `conversation-output-file-interactions.test.ts`，覆盖中文、空格和绝对路径：

```ts
test('resolveConversationOutputFileActionPath preserves unicode spaces and absolute paths', () => {
  assert.equal(
    resolveConversationOutputFileActionPath('D:\\项目 工作区', 'docs\\验收 文档.md'),
    'D:\\项目 工作区\\docs\\验收 文档.md',
  );
  assert.equal(
    resolveConversationOutputFileActionPath('D:\\项目 工作区', 'C:\\导出\\验收 文档.md'),
    'C:\\导出\\验收 文档.md',
  );
});
```

- [ ] **Step 2: 运行共享菜单测试确认 RED**

Run: `node --import tsx --test src/lib/file-action-menu.test.ts src/lib/conversation-output-file-interactions.test.ts`

Expected: `FileActionMenu.tsx should exist` 失败；既有路径测试继续通过。

- [ ] **Step 3: 新建共享 FileActionMenu**

组件接口固定为：

```ts
export type FileActionMenuTarget = {
  path: string;
  name: string;
};

type FileActionMenuProps = {
  target: FileActionMenuTarget | null;
  anchorRef?: RefObject<HTMLElement | null>;
  virtualAnchor?: { x: number; y: number } | null;
  placement?: 'bottom-start' | 'bottom-end';
  offset?: number;
  canPreview?: boolean;
  onClose: () => void;
  onPreview: (target: FileActionMenuTarget) => void | Promise<void>;
  onOpen: (path: string) => void | Promise<void>;
  onReveal: (path: string) => void | Promise<void>;
  onCopy: (path: string) => void | Promise<void>;
};
```

组件内部使用 `PopoverPortal`、`useOutsideDismiss` 和 `Escape`，所有动作经过同一个关闭函数：

```tsx
async function run(
  event: MouseEvent<HTMLButtonElement>,
  action: () => void | Promise<void>,
) {
  event.stopPropagation();
  try {
    await action();
  } finally {
    onClose();
  }
}

return (
  <PopoverPortal
    open={Boolean(target)}
    anchorRef={anchorRef ?? fallbackAnchorRef}
    virtualAnchor={virtualAnchor}
    placement={placement}
    offset={offset}
  >
    {target ? (
      <div ref={menuRef} className="workspace-menu conversation-output-file-menu" role="menu" aria-label={`文件操作 ${target.name}`}>
        {canPreview ? (
          <button type="button" className="workspace-menu-item conversation-output-file-menu-item" role="menuitem" onClick={(event) => void run(event, () => onPreview(target))}>
            <Maximize2 size={14} /><span>在右侧预览</span>
          </button>
        ) : null}
        <button type="button" className="workspace-menu-item conversation-output-file-menu-item" role="menuitem" onClick={(event) => void run(event, () => onOpen(target.path))}>
          <ArrowUpRight size={14} /><span>用默认应用打开</span>
        </button>
        <button type="button" className="workspace-menu-item conversation-output-file-menu-item" role="menuitem" onClick={(event) => void run(event, () => onReveal(target.path))}>
          <Folder size={14} /><span>在文件浏览器中显示</span>
        </button>
        <div className="workspace-menu-divider" role="separator" />
        <button type="button" className="workspace-menu-item conversation-output-file-menu-item" role="menuitem" onClick={(event) => void run(event, () => onCopy(target.path))}>
          <Copy size={14} /><span>复制完整路径</span>
        </button>
      </div>
    ) : null}
  </PopoverPortal>
);
```

`useOutsideDismiss` 的 anchorRefs 包含实际按钮 anchor；`target` 非空时注册 `keydown`，`Escape` 调用 `onClose`。

- [ ] **Step 4: 让文件产物卡片改用共享菜单**

`ConversationOutputFileCard` 保留主点击和“打开方式”按钮状态，只把内嵌 `PopoverPortal` 菜单替换为：

```tsx
<FileActionMenu
  target={menuOpen || contextMenu ? { path: resolvedFilePath, name: file.name } : null}
  anchorRef={menuButtonRef}
  virtualAnchor={contextMenu}
  placement="bottom-end"
  offset={8}
  canPreview={canPreviewInWorkbench}
  onClose={closeMenus}
  onPreview={() => openInWorkbenchPreview()}
  onOpen={onOpenOutputPath}
  onReveal={onRevealOutputPath}
  onCopy={(path) => navigator.clipboard.writeText(path)}
/>
```

删除卡片内重复的四项按钮和仅服务旧菜单的 outside-dismiss 配置，保留 `context-active` 状态。

- [ ] **Step 5: 将文件动作回调传到 MarkdownMessage**

在 `AssistantItemRenderProps` 增加：

```ts
onOpenOutputPath: (path: string) => Promise<void>;
onRevealOutputPath: (path: string) => Promise<void>;
```

`ConversationTurnViewComponent` 的 intermediate/narrative 两条 `renderAssistantItem` 调用、`IntermediateProcessBody` 和 `MarkdownMessage` 均透传这两个既有回调。`MarkdownMessage` 保存解析后的菜单目标：

```ts
const [fileMenuTarget, setFileMenuTarget] = useState<{
  path: string;
  name: string;
  x: number;
  y: number;
} | null>(null);

const resolveLocalFile = useCallback((path: string) => ({
  path: workspace ? resolveWorkbenchPreviewFilePath(workspace, path) : path,
  name: getFileName(path),
}), [workspace]);
```

`DeferredMarkdownContent` 增加 `onOpenLocalFileContextMenu`，正文 Markdown renderer 透传；`MarkdownMessage` 接收后解析路径并保存坐标：

```ts
onOpenLocalFileContextMenu={({ path, x, y }) => {
  setFileMenuTarget({ ...resolveLocalFile(path), x, y });
}}
```

在 `WebLinkActionMenu` 旁渲染共享文件菜单：

```tsx
<FileActionMenu
  target={fileMenuTarget}
  virtualAnchor={fileMenuTarget ? { x: fileMenuTarget.x, y: fileMenuTarget.y } : null}
  canPreview
  onClose={() => setFileMenuTarget(null)}
  onPreview={({ path, name }) => onOpenWorkbenchPreview(buildConversationOutputFilePreviewRequest({ path, name, type: 'file' }))}
  onOpen={onOpenOutputPath}
  onReveal={onRevealOutputPath}
  onCopy={(path) => navigator.clipboard.writeText(path)}
/>
```

- [ ] **Step 6: 运行共享菜单、链接和文件产物测试确认 GREEN**

Run:

```powershell
node --import tsx --test src/lib/file-action-menu.test.ts src/lib/markdown-link.test.ts src/lib/conversation-output-file-interactions.test.ts src/lib/conversation-output-files.test.ts
```

Expected: 全部 PASS；菜单固定四项，正文和产物卡片共同使用共享组件。

Run: `npm run typecheck`

Expected: PASS，无缺失回调或未使用导入。

Record: `npm run trellis -- record "完成正文文件链接与文件产物卡片共享四项文件动作菜单"`

### Task 8: 回归、真实验收与 Trellis 收尾

**Files:**
- Modify: `.trellis/tasks/link-opening-and-local-web-preview.md`
- Modify: `.trellis/workspace/sessions/session-20260801-082231-kz6b-link-opening-and-local-web-preview.md`

- [ ] **Step 1: 运行链接和文件相关完整测试集**

Run:

```powershell
node --import tsx --test src/lib/markdown-link.test.ts src/lib/web-link-action-menu.test.ts src/lib/file-action-menu.test.ts src/lib/conversation-output-file-interactions.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts
```

Expected: 0 failed。

- [ ] **Step 2: 运行质量门禁**

Run: `npm run typecheck`

Run: `npm run build`

Run: `git diff --check`

Expected: 全部成功；只允许记录 Vite 既有 chunk size 和动态导入提示。

- [ ] **Step 3: 重启桌面开发版并验收正文文件链接**

重启 `npm run desktop:dev` 后，在真实会话使用以下 Markdown：

```markdown
[相对文档](docs/验收 文档.md)
[绝对文档](C:\Users\demo\验收 文档.md)
[网页链接](https://example.com)
[页内位置](#result)
```

验收：

1. 相对文件链接左键仍在右侧预览。
2. 相对/绝对文件链接右键固定显示四项，复制结果为完整路径。
3. 默认应用打开和文件浏览器显示成功或给出既有错误提示，不静默失败。
4. 网页链接仍显示网页三项菜单，页内锚点不显示文件菜单。
5. 文件产物卡片的按钮菜单和右键菜单使用相同四项文案与顺序。
6. 外部点击、`Escape` 和执行动作均关闭菜单。

- [ ] **Step 4: 验收 Web、主题和窄窗口**

在 `http://127.0.0.1:5173` 重复正文文件链接右键操作，确认不触发主页面重载。分别检查浅色/深色和常规/窄窗口：菜单被 viewport 钳制，文案不截断，正文、卡片和菜单不重叠。

- [ ] **Step 5: 写回验证并完成任务**

按实际结果逐条登记，不合并或省略失败项：

```powershell
npm run trellis -- verify "node --import tsx --test src/lib/markdown-link.test.ts src/lib/web-link-action-menu.test.ts src/lib/file-action-menu.test.ts src/lib/conversation-output-file-interactions.test.ts src/lib/conversation-output-files.test.ts src/lib/conversation-web-previews.test.ts src/lib/conversation-web-preview-ui.test.ts src/lib/workbench-browser.test.ts src/lib/workbench-browser-ui.test.ts" --result "全部通过，0 failed；记录实际通过数量"
npm run trellis -- verify "npm run typecheck" --result "通过，0 个 TypeScript 错误"
npm run trellis -- verify "npm run build" --result "通过；仅有已确认的 Vite chunk size 或动态导入提示"
npm run trellis -- verify "git diff --check" --result "通过，无空白错误"
npm run trellis -- verify "桌面正文文件链接右键验收" --result "相对/绝对/中文/空格路径四项动作、菜单关闭、网页与锚点隔离、文件产物菜单一致性均通过，0 项失败"
npm run trellis -- verify "Web 文件链接菜单与响应式视觉验收" --result "主页面未重载；浅色/深色及常规/窄窗口下菜单定位、文案和层级均通过，0 项失败"
```

全部通过后执行：

```powershell
npm run trellis -- complete --summary "完成网页链接默认行为、本地网页预览，以及正文文件链接与文件产物卡片共享四项右键菜单；相关自动化和桌面/Web 交互均已验证"
```

- [ ] **Step 6: 最终差异审查和选择性提交**

检查 `git status --short` 和任务相关逐文件 diff。由于 `ConversationTurn.tsx` 等文件含此前同任务及其他未提交修改，只选择性暂存本任务 hunks，不带入无关后端、队列、附件或其他 Trellis 任务文件。

Commit: `feat: 增加正文文件链接右键菜单`
