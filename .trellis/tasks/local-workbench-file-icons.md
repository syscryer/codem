# Task: 工作台本地文件图标

## Background

工作台文件树、审查树、Git 提交详情和附件引用当前通过 `vscode-icons-js` 解析文件名，再从 jsDelivr CDN 加载 SVG。首次打开或网络较慢时会出现文字先显示、图标随后补上的延迟，并且离线环境只能等待请求失败后再显示兜底图标。`D:\Projects\mxterm` 已采用本地同步 SVG 方案，证明该类图标可以脱离网络资源即时渲染。

## Objective

移除文件树、审查和 Git 提交详情中的远程图标请求，统一为同步本地 SVG，并扩展常见文件类型覆盖

## Scope

In scope:

- 新增统一的本地文件图标描述器和 React/SVG 组件。
- 文件树、审查树、Git 提交详情、工作台标签和聊天输入文件引用统一复用该组件。
- 覆盖常见开发语言、配置/锁文件、构建工具、数据库、文档、媒体、归档、证书、字体、可执行文件和常见目录名。
- 移除 `vscode-icons-js` 和 jsDelivr 文件图标网络依赖。
- 补充解析器测试与源码级网络依赖回归检查。

Out of scope:

- 不改变文件树数据请求、展开/折叠、筛选、选择和 Git 操作行为。
- 本轮不引入文件树虚拟滚动；仅在后续大目录基准显示仍有瓶颈时单独处理。
- 不追求逐像素复刻第三方图标集或每个品牌的官方标志。

## Impact

- frontend: `src/lib/**` 图标解析逻辑、`src/components/**` 共享图标组件和各消费入口。
- styling: 工作台与附件引用的图标尺寸、颜色和暗色主题适配。
- dependencies: 移除 `vscode-icons-js`。

## Acceptance Criteria

- [x] 文件树、审查树和 Git 提交详情中的文件图标同步显示，不发起 HTTP/CDN 请求。
- [x] 工作台标签和聊天输入文件引用使用同一套本地图标解析结果。
- [x] 常见文件名、目录名和扩展名具有可区分图标，未知类型显示稳定的默认文件图标。
- [x] 文件夹展开状态可以区分，图标宽高固定且不改变现有行布局。
- [x] 浅色和深色主题下图标保持可辨识。
- [x] `vscode-icons-js` 从生产依赖和锁文件移除。
- [x] 类型检查、相关单元测试和生产构建通过。
- [x] 工作台文件树、审查、Git 提交详情和预览标签的本地图标默认使用 18px，聊天输入紧凑列表继续使用显式 16px。
- [x] Rust 项目文件接口与 Node 旧后端保持一致：文件夹优先，同类条目按名称不区分大小写排序。
- [x] Rust 排序回归测试、前端类型检查和生产构建通过。

## Verification Commands

- `node --import tsx --test src/lib/workbench-file-icons.test.ts src/lib/workbench-files.test.ts src/lib/file-reference-paths.test.ts`
- `node scripts/check-workbench-local-icons-source.mjs`
- `npm run typecheck`
- `npm run build`
- `rg -n "cdn\.jsdelivr\.net|vscode-icons-js|resolveWorkbenchFileIcon\(" src package.json package-lock.json src-tauri/tauri.conf.json --glob "!src/lib/file-reference-paths.test.ts"`
- `cargo test --manifest-path src-tauri/Cargo.toml project_file_entries_sort_directories_before_files`

## Implementation Record

- 2026-07-12T06:02:56.654Z 将共享 WorkbenchFileIcon 默认尺寸从 16px 调整为 18px，Composer 紧凑引用保留显式 16px；修复 Rust list_project_files 类型比较方向，改为文件夹优先并按名称不区分大小写排序，新增回归测试。
- 2026-07-12T04:11:59.055Z 已实现共享 WorkbenchFileIcon 本地 SVG 组件和广泛文件类型解析器；文件树、审查树、Git 提交详情、工作台标签及 @文件引用均同步复用；已移除 vscode-icons-js 与 jsDelivr CSP 白名单。

- 2026-07-12T03:45:29.658Z Task created by Trellis automation.

## Verification Results

- 2026-07-12T06:03:36.984Z `GET /api/projects/:id/files`: 重启后的 Rust 后端实测 notra 返回 9 个目录后跟 6 个文件，首个文件索引为 9，目录和文件组内名称排序正确。
- 2026-07-12T06:03:30.682Z `npm run typecheck && node scripts/check-workbench-local-icons-source.mjs && npm run build`: 通过；图标默认 18px 源码检查、TypeScript 检查和 Vite 生产构建均成功。

- 2026-07-12T06:03:17.804Z `cargo test --manifest-path src-tauri/Cargo.toml project_file_entries_sort_directories_before_files`: 通过，Rust 排序回归测试 1/1 成功。
- 2026-07-12T04:22:42.144Z `Invoke-WebRequest http://127.0.0.1:5173/`: 开发服务已启动，Web 端返回 HTTP 200；Rust 后端监听 127.0.0.1:3001。

- 2026-07-12T04:22:31.127Z `node scripts/check-workbench-local-icons-source.mjs && npm run build`: 通过；本地图标源码检查成功，TypeScript 与 Vite 生产构建成功，产物无 jsDelivr 或 vscode-icons-js。
- 2026-07-12T04:22:17.071Z `node --import tsx --test src/lib/workbench-file-icons.test.ts src/lib/workbench-files.test.ts src/lib/file-reference-paths.test.ts`: 通过，37/37 测试成功，覆盖多类语言、配置、资源、归档、二进制、目录和未知文件兜底。

## Completion Summary

- 2026-07-12T06:03:52.466Z 本地图标默认尺寸调整为 18px；修复 Rust 项目文件列表排序为文件夹优先、同类名称不区分大小写排序，并通过回归测试、生产构建和 notra 实际接口验证。
- 2026-07-12T04:26:13.926Z 工作台文件树、审查树、Git 提交详情、预览标签和 @文件引用已统一使用同步本地 SVG 图标；扩展常见文件类型与目录映射，移除远程 CDN 图标依赖，并通过 37 项测试、源码检查和生产构建。

## Follow-ups

- 如数百到数千节点目录仍有明显交互延迟，再独立评估节点 memo、选择状态预计算与虚拟列表。
