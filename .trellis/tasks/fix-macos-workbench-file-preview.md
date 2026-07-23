# Task: 修复 macOS 文件预览路径

## Background

macOS 桌面版的项目文件树可以正常列出文件，但点击文件后预览接口返回 `No such file or directory (os error 2)`。前端将项目根路径与相对路径固定使用 Windows 反斜杠拼接，导致 `/Users/.../codem\src\...` 在 macOS 被解释为不存在的文件名。

## Objective

按平台路径风格拼接项目文件绝对路径，恢复 macOS 文件预览并保持 Windows 行为不变

## Scope

In scope:

- 修正工作台项目文件绝对路径的跨平台拼接规则。
- 让文件预览与 Git 历史的打开/显示文件路径复用同一规则。
- 增加 Windows、macOS 和绝对路径回归测试。

Out of scope:

- 不修改文件树、预览器布局、高亮逻辑和交互。
- 不改变文件预览后端权限边界、大小限制或二进制判断。

## Impact

- `src/lib/workbench-files.ts` 的项目路径拼接 helper。
- `src/lib/workbench-preview.ts` 的预览路径解析及其测试。
- Windows 继续输出原有反斜杠路径，macOS/Linux 输出 POSIX 路径。

## Acceptance Criteria

- [x] macOS 项目相对文件路径解析为真实 POSIX 绝对路径。
- [x] Windows 驱动器路径和绝对路径行为保持不变。
- [x] 文件预览、前端类型检查和 production build 通过。

## Verification Commands

- `node --test --import tsx src/lib/workbench-preview.test.ts src/lib/workbench-files.test.ts src/lib/file-preview-api.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Implementation Record
- 2026-07-23T01:44:32.498Z 确认根因是工作台预览路径固定使用 Windows 反斜杠；已让预览与 Git 历史路径复用按项目根路径风格拼接的 combineProjectFilePath，并补充 Windows/macOS 回归断言。

- 2026-07-23T01:43:19.876Z Task created by Trellis automation.

## Verification Results

- 2026-07-23T01:51:17.423Z `git diff --check`: 通过：无空白错误；Tauri 自动写入的 Cargo feature 已恢复，未修改后端。
- 2026-07-23T01:51:17.402Z `开发版 files API + resolveWorkbenchPreviewFilePath + file-preview API`: 通过：文件树返回 src/lib/agent-model-selection.test.ts，helper 解析为 /Users/mars/Documents/project/codem/src/lib/agent-model-selection.test.ts，预览接口返回 HTTP 200 和 2086 字节内容。

- 2026-07-23T01:51:17.380Z `npm run typecheck；npm run build`: 通过：TypeScript project build 与 Vite production build 成功，仅有既有 chunk size 提示。
- 2026-07-23T01:51:17.355Z `node --test --import tsx src/lib/workbench-preview.test.ts src/lib/workbench-files.test.ts src/lib/file-preview-api.test.ts`: 通过：14/14，覆盖 macOS POSIX、Windows 驱动器、Windows UNC、绝对路径直通和预览 API URL。

## Completion Summary
- 2026-07-23T01:51:31.274Z 修复 macOS 工作台文件预览固定使用 Windows 反斜杠的问题，统一按项目路径风格拼接；Windows 驱动器和 UNC 行为保持不变，开发版端到端预览返回 200。

## Follow-ups

- 无。
