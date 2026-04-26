# Task: Settings Appearance Foundation

## Objective

为 CodeM 建立正式设置页骨架，并优先落地“外观”设置。

目标不是做临时面板，而是一次性确定后续设置模块可持续扩展的基础形态：

- 设置作为应用一级视图，不使用 modal。
- 左侧设置分类按最终信息架构展示。
- 第一阶段只实现“外观”，其他分类保留空态。
- 外观设置即时生效，并持久化到本地设置文件。
- 视觉风格参考用户给出的浅色系统设置截图：轻量、居中、行式设置、弱边框。

## Reference

可参考但不直接照搬：

- `D:\project\desktop-cc-gui\src\features\settings\components\SettingsView.tsx`
- `D:\project\desktop-cc-gui\src\features\settings\hooks\useAppSettings.ts`
- `D:\project\desktop-cc-gui\src\features\settings\components\settings-view\sections\BasicAppearanceSection.tsx`
- `D:\project\desktop-cc-gui\src\styles\settings.part1.css`

参考点：

- 设置页为嵌入式一级视图。
- 设置 section 类型集中定义。
- 默认值、normalize、持久化 hook 分层。
- 外观 section 独立组件。

不要照搬：

- 过大的 `SettingsView` 单体状态。
- 复杂主题编辑器。
- 深色控制台式卡片视觉。
- 大量暂时不可用的配置项逻辑。

## Scope

涉及目录：

- `src/**`
- `server/**`
- 必要时更新 `.trellis/spec/**` 中与设置存储或页面结构相关的说明

不进入 SQLite：

- 外观设置是用户本机偏好，不需要同步。
- 第一版存本地 JSON 文件，通过后端 API 读写。

## Settings Sections

左侧设置分类按以下顺序建立：

1. 基础设置
2. 外观
3. 快捷键
4. 供应商管理
5. 使用情况
6. 会话管理
7. MCP 管理
8. Skills
9. 全局提示词
10. 打开方式

第一阶段：

- “外观”可用。
- 其他分类展示空态，文案保持克制，例如“此分类稍后接入。”
- 不要把未实现分类隐藏，避免后续信息架构反复调整。

## Appearance Settings

第一版字段：

```ts
type AppearanceSettings = {
  themeMode: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  uiFontSize: 12 | 13 | 14 | 15;
  codeFontSize: 12 | 13 | 14;
  sidebarWidth: 'narrow' | 'default' | 'wide';
};
```

默认值：

```ts
const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  density: 'comfortable',
  uiFontSize: 13,
  codeFontSize: 12,
  sidebarWidth: 'default',
};
```

暂不做：

- 自定义颜色项
- 主题导入/导出
- 背景图片
- 毛玻璃强度
- 圆角、阴影等细粒度调参

## Storage Model

设置文件建议形态：

```json
{
  "appearance": {
    "themeMode": "system",
    "density": "comfortable",
    "uiFontSize": 13,
    "codeFontSize": 12,
    "sidebarWidth": "default"
  }
}
```

后端职责：

- 新增 `server/lib/settings-store.ts` 或等价模块。
- 读取本地 app data 目录下的 `settings.json`。
- 缺字段时与默认值合并。
- 写入时使用临时文件 + rename，避免崩溃导致配置损坏。
- 读失败时回退默认值。
- 写失败时返回明确错误，由前端 toast。

API 建议：

- `GET /api/settings`
- `PUT /api/settings/appearance`

前端职责：

- 启动时加载设置。
- 修改后立即应用。
- 修改后立即保存。
- 保存失败时提示，但不要导致页面崩溃。

## UX Model

入口：

- 左下角“设置”按钮进入设置视图。
- 不打开 modal，不覆盖聊天区。
- 当前项目、线程、运行状态保留在内存中。

返回：

- 设置页提供“返回工作区”入口。
- 返回后恢复原来的工作区视图。
- 不刷新项目列表，不重置当前线程。

状态模型建议：

```ts
type AppView =
  | { kind: 'workspace' }
  | { kind: 'settings'; section: SettingsSection };

type SettingsSection =
  | 'basic'
  | 'appearance'
  | 'shortcuts'
  | 'providers'
  | 'usage'
  | 'sessions'
  | 'mcp'
  | 'skills'
  | 'globalPrompts'
  | 'openWith';
```

## Visual Direction

整体风格：

- 大面积白底。
- 设置左栏浅灰背景。
- 左栏选中项为浅灰圆角条。
- 右侧内容居中，宽度控制在约 `640px`。
- 标题简洁，例如“外观”。
- 设置面板白底、细边框、轻圆角。
- 行式设置，每行固定高度。
- 控件靠右，使用 segmented control、stepper、select 等轻量控件。

外观页结构：

```text
外观

[轻量预览面板]
  sidebar + header + chat + composer + footer 的缩略示意

[设置面板]
主题              跟随系统 | 浅色 | 深色
界面密度          舒适 | 紧凑
UI 字号           - 13 +
代码字号          - 12 +
侧边栏宽度        窄 | 默认 | 宽
```

样式约束：

- 不做多层卡片嵌套。
- 不做营销式 hero。
- 不做强渐变背景。
- 控件高度、行高、间距要固定，避免视觉漂移。
- 设置页需要适配当前应用窗口大小，窄窗口下不能出现文字重叠。

## Execution Order

### Stage 1. Task And Contract

目标：

- 固化设置页信息架构、外观字段、存储方式。

待办：

- [x] 建立本任务文档。
- [x] 建立 Superpowers 执行计划：`docs/superpowers/plans/2026-04-26-settings-system-plan.md`。
- [x] 明确 MCP / Skills 不在第一版实现，后续参考 `D:\project\cc-switch` 单独规划。
- [x] 确认最终左侧分类命名。
- [x] 确认外观第一版字段不再扩张。

### Stage 2. Settings Store And API

目标：

- 建立本地文件设置存储和 API。

待办：

- [x] 新增设置类型与默认值。
- [x] 新增后端 settings store。
- [x] 新增 `GET /api/settings`。
- [x] 新增 `PUT /api/settings/appearance`。
- [x] 增加输入 normalize，拒绝非法字段值。
- [x] 写入使用临时文件 + rename。

验收：

- 删除设置文件后，应用能使用默认外观启动。
- 修改外观设置后，重启应用仍能恢复。
- 写入非法值不会污染设置文件。

### Stage 3. Frontend Settings State

目标：

- 前端有统一设置状态入口。

待办：

- [x] 新增 `useAppSettings` 或等价 hook。
- [x] 启动时加载设置。
- [x] 提供 `updateAppearanceSettings`。
- [x] 保存失败时显示 toast。
- [x] 设置未加载完成时使用默认值渲染。

验收：

- 设置加载失败不影响主应用可用。
- 外观修改即时反映到 UI。

### Stage 4. Settings View Shell

目标：

- 设置作为一级视图接入应用。

待办：

- [x] 增加 `AppView` 状态。
- [x] 左下角设置按钮进入设置视图。
- [x] 设置页左栏展示全部分类。
- [x] 默认进入“外观”。
- [x] 支持返回工作区。
- [x] 非外观分类展示空态。

验收：

- 进入/退出设置不丢失当前项目与线程。
- 设置页不是 modal，不遮罩主界面。

### Stage 5. Appearance Page

目标：

- 实现外观页 UI 和设置控件。

待办：

- [x] 增加外观页标题。
- [x] 增加轻量预览面板。
- [x] 增加主题 segmented control。
- [x] 增加密度 segmented control。
- [x] 增加 UI 字号 stepper。
- [x] 增加代码字号 stepper。
- [x] 增加侧边栏宽度 segmented control。
- [x] 控件变更后即时保存。

验收：

- 页面风格与参考截图方向一致。
- 控件大小、行高、右侧对齐稳定。
- 设置项变更不会导致布局抖动。

### Stage 6. Apply Appearance

目标：

- 外观设置真正影响应用界面。

待办：

- [x] `themeMode` 应用到根节点 data attribute 或 class。
- [x] `density` 应用到根节点 data attribute 或 class。
- [x] `uiFontSize` 写入 CSS variable。
- [x] `codeFontSize` 写入 CSS variable。
- [x] `sidebarWidth` 写入 CSS variable。
- [x] 调整现有 CSS 使用这些变量。

验收：

- UI 字号影响普通界面文本。
- 代码字号影响代码块 / diff / 等宽文本区域。
- 侧边栏宽度切换生效。
- 密度切换影响侧栏行高、消息间距、footer 高度等关键区域。

### Stage 7. Verification

目标：

- 给设置页第一版建立基本回归信心。

待办：

- [x] 跑 `npm run typecheck`。
- [x] 跑 `npm run build`。
- [ ] 浏览器验证进入设置、切换外观、返回工作区。
- [ ] 刷新浏览器验证设置恢复。
- [ ] 重启 dev server 验证设置文件恢复。

## Risks

- 设置状态散落在多个组件中，后续分类接入时难维护。
- 外观变量接入不完整，导致部分 UI 不跟随设置。
- 设置页进入/退出时误触发线程刷新或项目状态重置。
- 本地设置文件损坏时未兜底，导致应用启动失败。
- 控件设计过度复杂，偏离轻量系统设置风格。

## Notes

- 后续提交记录使用中文。
- 先保留最终分类，但只实现“外观”。
- 外观设置不进入 SQLite，除非未来明确需要同步或多设备共享。
- API 仍由后端统一提供，前端不直接读写本地文件。
- 每个阶段结束都要用浏览器看实际界面，避免样式只在代码层面成立。
