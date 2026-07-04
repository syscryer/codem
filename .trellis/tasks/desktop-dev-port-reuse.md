# Task: 修复桌面开发误复用占用端口

## Background

用户手工退出过 CodeM 桌面开发模式后，本地 `3001`、`5173` 等常用端口可能被其他工具占用。现有 `desktop:dev` 启动逻辑只要看到首选端口有监听，就会直接复用，导致桌面壳误连到其他本地服务，界面展示出不属于 CodeM 的页面内容。

## Objective

避免 desktop:dev 因本地 3001/5173 被其他程序占用而误复用错误服务

## Scope

In scope:

- `desktop:dev` 仅复用当前仓库自己的有效 dev session，不再因为首选端口有监听就直接复用。
- 复用 session 时，除了校验端口可访问，还要校验 session 中记录的 dev 进程 `pid` 仍然存活。
- 没有有效 session，或 session `pid` 已失效时，重新分配空闲端口并启动新的前后端开发服务。
- 为端口复用与 session 失效场景补充脚本测试。

Out of scope:

- 不修改业务前后端接口本身。
- 不改动桌面壳窗口行为和 Tauri 配置。
- 不处理用户手工占用端口时的提示文案优化。

## Impact

- scripts：`scripts/desktop-dev-runtime.mjs`、`scripts/desktop-dev-runtime.test.mjs`
- workflow：`.trellis/tasks/desktop-dev-port-reuse.md`、对应 session record

## Acceptance Criteria

- [x] 当本地 `3001/5173` 被其他程序占用，但当前仓库没有有效 dev session 时，`desktop:dev` 会重新选择空闲端口，而不是复用占用端口。
- [x] 当存在有效 dev session 且 session 记录的 `pid` 仍存活时，`desktop:dev` 继续复用该 session 的端口。
- [x] 当 session 文件存在但 `pid` 已失效时，`desktop:dev` 不复用旧端口，改为重新分配空闲端口。
- [x] 脚本测试覆盖有效 session、失效 session、无 session、首选端口被占用和 `pid` 失效场景。

## Verification Commands

- `node --test scripts/desktop-dev-runtime.test.mjs scripts/dev-session.test.mjs`
- `npm run typecheck`
- `npm run desktop:dev`

## Implementation Record
- 2026-07-04T06:42:07.073Z 修复 desktop:dev 端口复用策略：仅复用当前仓库有效 dev session；无 session 或 session pid 失效时改为重新分配空闲端口，避免误连到其他工具。

- 2026-07-04T06:40:08.281Z Task created by Trellis automation.

## Verification Results
- 2026-07-04T06:43:05.775Z `npm run typecheck`: TypeScript 构建检查通过。

- 2026-07-04T06:43:05.754Z `后台启动 npm run desktop:dev 并检查 codem.exe / 5175 监听`: 桌面壳已启动，codem.exe 运行中，前端使用新端口 5175。
- 2026-07-04T06:43:05.729Z `node --test scripts/desktop-dev-runtime.test.mjs scripts/dev-session.test.mjs`: 8 个测试全部通过，覆盖有效 session、失效 session、无 session、占用首选端口和 pid 失效场景。

## Completion Summary
- 2026-07-04T06:43:05.776Z 修复 desktop:dev 对无效 session 和被占用首选端口的误复用问题；现在仅复用当前仓库有效 dev session，否则改为重新分配空闲端口并成功启动桌面壳。

## Follow-ups

- 待补充。
