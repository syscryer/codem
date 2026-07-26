# Session Record: 修复 macOS 文件预览路径

- Session: session-20260723-014319-824p
- Started: 2026-07-23T01:43:19.872Z
- Task: .trellis/tasks/fix-macos-workbench-file-preview.md

## Notes
- 2026-07-23T01:44:32.498Z 确认根因是工作台预览路径固定使用 Windows 反斜杠；已让预览与 Git 历史路径复用按项目根路径风格拼接的 combineProjectFilePath，并补充 Windows/macOS 回归断言。

- 2026-07-23T01:43:19.876Z Session started.

## Verification

- 2026-07-23T01:51:17.423Z `git diff --check`: 通过：无空白错误；Tauri 自动写入的 Cargo feature 已恢复，未修改后端。
- 2026-07-23T01:51:17.402Z `开发版 files API + resolveWorkbenchPreviewFilePath + file-preview API`: 通过：文件树返回 src/lib/agent-model-selection.test.ts，helper 解析为 /Users/mars/Documents/project/codem/src/lib/agent-model-selection.test.ts，预览接口返回 HTTP 200 和 2086 字节内容。

- 2026-07-23T01:51:17.380Z `npm run typecheck；npm run build`: 通过：TypeScript project build 与 Vite production build 成功，仅有既有 chunk size 提示。
- 2026-07-23T01:51:17.355Z `node --test --import tsx src/lib/workbench-preview.test.ts src/lib/workbench-files.test.ts src/lib/file-preview-api.test.ts`: 通过：14/14，覆盖 macOS POSIX、Windows 驱动器、Windows UNC、绝对路径直通和预览 API URL。

## Completed

- 2026-07-23T01:51:31.274Z 修复 macOS 工作台文件预览固定使用 Windows 反斜杠的问题，统一按项目路径风格拼接；Windows 驱动器和 UNC 行为保持不变，开发版端到端预览返回 200。
