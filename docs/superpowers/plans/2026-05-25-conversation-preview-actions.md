# Conversation Preview Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收口会话中的代码审查与文档打开入口，去掉重复的摘要行打开按钮，并新增“产出文件”卡片区。

**Architecture:** 在前端把“代码变更卡”和“产出文件卡片”拆成两条交互链路。代码类文件继续复用现有右侧工作台审查能力；文档类文件从工具调用中提取为独立卡片，文本类走右侧预览，Office/PDF 类走系统默认应用，同时补一个资源管理器定位文件接口承接右键菜单。

**Tech Stack:** React 19、TypeScript、node:test、Express、PowerShell 文件打开能力

---

### Task 1: 预览动作判定与产出文件提取

**Files:**
- Create: `src/lib/conversation-output-files.ts`
- Create: `src/lib/conversation-output-files.test.ts`
- Modify: `src/lib/workbench-preview.ts`
- Modify: `src/lib/workbench-preview.test.ts`

- [ ] **Step 1: 写产出文件提取与打开方式判定的失败测试**

覆盖：
- 代码文件不进入产出文件列表
- `md/json/html/txt/csv/yaml` 判定为 `preview`
- `doc/docx/xls/xlsx/ppt/pptx/pdf` 判定为 `default-app`
- 同一路径去重

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/conversation-output-files.test.ts src/lib/workbench-preview.test.ts`

- [ ] **Step 3: 实现最小工具函数**

实现：
- 从 `ToolStep[]` 提取文档型产出文件
- 判定卡片点击行为
- 保持现有 `conversation-card` diff 判定仅在有 `reviewDiff` 时成立

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test src/lib/conversation-output-files.test.ts src/lib/workbench-preview.test.ts`

### Task 2: 会话内卡片交互收口

**Files:**
- Modify: `src/components/ConversationTurn.tsx`
- Modify: `src/components/ConversationPane.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 写 UI 侧失败测试或补纯函数测试覆盖入口文案/分类**

至少覆盖：
- 代码摘要行不再渲染顶部 `打开`
- 代码卡片入口文案改为 `审查`
- 有文档型产出时会渲染产出文件数据结构

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run typecheck`

- [ ] **Step 3: 实现前端最小改动**

实现：
- 删除代码摘要行 `打开`
- 展开后的代码卡片按钮改成 `审查`
- 新增 `产出文件` 卡片区
- 文本类卡片整卡点击走右侧文件预览
- Office/PDF 类卡片整卡点击走默认应用打开
- 产出文件卡片右键菜单包含 `在文件浏览器打开`、`复制路径`
- 会话产出文件预览默认不主动展开文件浏览栏；若用户此前手动展开，则保持当前显隐状态

- [ ] **Step 4: 运行验证**

Run:
- `npm run typecheck`
- `node --import tsx --test src/lib/conversation-output-files.test.ts src/lib/conversation-changed-files.test.ts src/lib/workbench-preview.test.ts`

### Task 3: 文件打开后端能力补齐

**Files:**
- Modify: `server/lib/system-dialog.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: 写失败测试或最小接口验证**

覆盖：
- 默认打开文件继续走现有 `openPath`
- 新增资源管理器定位文件能力，Windows 下使用选中文件行为

- [ ] **Step 2: 运行验证确认失败或缺失**

Run: `npm run typecheck`

- [ ] **Step 3: 实现最小后端接口**

实现：
- 在 `system-dialog.ts` 增加资源管理器定位文件方法
- 在 `/api/system/open-path` 增加模式参数，或新增单独 reveal 接口

- [ ] **Step 4: 运行最终验证**

Run:
- `npm run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `node --import tsx --test src/lib/conversation-output-files.test.ts src/lib/conversation-changed-files.test.ts src/lib/workbench-preview.test.ts`
