# Task: 修复历史图片附件缩略图

## Background

桌面端图片预览接口受 Agent Mux Bearer Token 保护，普通 `<img>` 请求无法经过前端认证桥接，导致实时消息和历史会话中的图片附件显示破图。

## Objective

让本地图片预览通过认证 fetch 获取 Blob，再使用短生命周期 Object URL 渲染；保持附件发送、持久化和其他 Agent 行为不变。

## Scope

In scope:

- 用户消息图片附件缩略图。
- 图片放大预览弹窗。
- 认证预览端点识别、Blob URL 回收和失败状态。
- 相关单元测试与前端构建验证。

Out of scope:

- 后端权限、URL token 传递方式和附件存储格式。
- 聊天输入框自适应、附件发送流程及其他 Agent 逻辑。

## Impact

- 仅影响两个图片展示入口；普通外部图片继续使用原始 URL。
- 不把凭据写入 URL 或持久化状态。

## Acceptance Criteria

- [x] 认证预览请求由 fetch 携带现有认证上下文。
- [x] 认证成功且 MIME 为 image/* 时显示图片，卸载时回收 Object URL。
- [x] 未授权或非图片响应显示明确加载失败状态，不伪造缩略图。
- [x] 普通图片 URL 不走认证 fetch。
- [x] 不改变附件发送、历史持久化和其他 Agent 行为。

## Verification Commands

- `node --import tsx --test src/lib/authenticated-image.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- 动态 Agent Mux 图片接口：无认证 `401`，带 Bearer Token `200 image/png`。

## Implementation Record
- 2026-08-11T02:30:33.832Z 完成认证图片组件、缩略图和放大预览接入；未改变后端权限、附件发送和其他 Agent 流程。

- 2026-08-11T02:14:44.175Z Task created by Trellis automation.
- 新增 `AuthenticatedImage`，统一处理受保护的本地图片预览。
- `ConversationTurn` 和 `ImagePreviewDialog` 改用认证图片组件。
- 增加加载占位样式和专项测试。
- 重启桌面开发壳，确认新的 Agent Mux runtime 已生成。

## Verification Results
- 2026-08-11T02:30:34.456Z `node --import tsx --test src/lib/authenticated-image.test.ts; npm run typecheck; npm run build; git diff --check; 动态图片接口认证对照`: 专项测试2/2通过；typecheck/build/diff check通过；无认证401，Bearer认证200 image/png；桌面开发壳已重启。

- 专项测试：2/2 通过。
- 类型检查：通过。
- 前端构建：通过；仅保留既有 chunk 体积提示。
- diff 检查：通过。
- 真实接口：不带认证 `401`；带当前 Bearer Token `200 image/png`。
- 浏览器直连 Vite 冒烟无法作为桌面验收：缺少 Tauri/认证桥接上下文，工作区 API 返回 `500`。

## Completion Summary
- 2026-08-11T02:30:35.122Z 修复受保护本地图片附件的认证加载，覆盖实时/历史缩略图和放大预览；保留其他未提交工作，浏览器直连Vite因缺少桌面桥接不作为验收依据。

完成受保护本地图片附件的认证加载，覆盖缩略图和放大预览；未修改后端权限或其他 Agent 流程。

## Follow-ups

- 在桌面窗口中打开包含历史图片附件的会话，确认缩略图和放大预览视觉效果。
