# Task: 结构化提问支持自定义回答

## Background

CodeM 已能把 Claude Code 的 `AskUserQuestion` / `RequestUserInput` 渲染为聊天流内联卡片，但带预设选项的问题只有选项按钮，没有自由文本入口。参考 `D:\ai_proj\claudinal` 的交互，用户需要在不离开当前卡片的前提下填写预设之外的答案。

后续实测发现，正在运行或从历史恢复的 Claude 提问可能仍是旧事件形态，选项问题不包含 `isOther`。前端仅依赖该字段会继续隐藏自定义输入，因此还需要以当前线程 Provider 作为 Claude 能力来源。

## Objective

保持现有内联提问卡片，为 Claude 选项问题补充自定义回答，并正确处理单选互斥、多选组合和后端透传

## Scope

In scope:

- Claude 结构化提问有预设选项时，在现有问题块下方展示“自定义回答”输入区。
- 单选问题中预设选项与自定义回答互斥。
- 多选问题允许同时提交预设选项和自定义回答。
- Rust Claude bridge 保留并正确写回自定义回答。
- 为前端状态转换和 Rust 回答归一化补充回归测试。
- Claude 当前线程即使收到不含 `isOther` 的旧形态问题，也显示自定义回答。

Out of scope:

- 不改为弹窗，不重做现有内联提问卡片视觉语言。
- 不改变普通聊天机制。
- 不扩展 ACP Agent 的选项协议；OpenCode、Grok 等仍按各自能力和校验运行。
- 不引入多模型回答或其他会话能力。

## Impact

- Frontend: `src/components/ConversationTurn.tsx`
- Backend: `src-tauri/src/backend.rs`
- Tests: 现有 TypeScript 测试与 Rust backend 测试模块
- Persistence: 不新增字段，继续复用 `submittedAnswers` 字符串格式。

## Acceptance Criteria

- [x] Claude 选项问题在现有内联卡片中显示“自定义回答”输入区。
- [x] 单选时输入自定义内容会清空预设选项，点击预设项会清空自定义内容。
- [x] 多选时预设项和自定义内容可以组合提交，提交结果不丢失任一部分。
- [x] 已提交卡片能从 `submittedAnswers` 恢复预设项与自定义文本。
- [x] 不影响无选项文本问题和非 Claude Agent 的既有行为。
- [x] TypeScript 定向测试、Rust 定向测试、类型检查、格式检查及浏览器内联样式验收通过。
- [x] 用户截图对应的多问题运行中卡片全部显示自定义回答。
- [x] OpenCode、Grok、Codex 等非 Claude Provider 在未声明 `isOther` 时仍不显示自由文本。

## Verification Commands

- `node --import tsx --test <相关 TypeScript 测试文件>`
- `cargo test --manifest-path src-tauri/Cargo.toml request_user_input`
- `npm run typecheck`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `git diff --check`
- Playwright 打开 `http://127.0.0.1:5173` 验证现有内联提问卡片。

## Implementation Record

- 2026-07-15T11:32:35.674Z 用户截图确认输入框仍缺失。真实 bootstrap 证明 Provider 为 claude-code；进程核对发现截图来自已安装版 C:\Users\csm\AppData\Local\CodeM\codem.exe，而非当前仓库桌面开发版。重新启动 npm run desktop:dev，生成独立 com.mnl.codem.dev 实例。
- 2026-07-15T10:48:45.206Z 修复旧 Claude 提问事件不显示自定义回答：将 activeProviderId 透传到 ConversationPane、ConversationTurn 与提问卡片，显示规则同时考虑 Claude Provider、isOther 和无选项文本题；普通聊天与其他 Agent 保持隔离。

- 2026-07-15T10:25:59.743Z 已实现 Claude 内联自定义回答：前端使用原子草稿状态保证单选互斥、多选组合；Rust 解析为选项问题启用 isOther，并在多选归一化中保留自定义文本。
- 2026-07-15T10:22:11.582Z 需求边界已确认：沿用现有聊天内联提问卡片；Claude 选项问题增加自定义回答，单选互斥、多选组合；不扩展普通聊天和 ACP Agent 协议。

- 2026-07-15T10:20:03.078Z Task created by Trellis automation.

## Verification Results
- 2026-07-15T11:32:37.594Z `Playwright http://127.0.0.1:5174 历史提问卡片`: 通过：截图对应的 4 个选项问题存在 textbox question-0，placeholder 为自定义回答；三问题卡片也分别存在 question-0/1/2；控制台 0 error。

- 2026-07-15T11:32:36.615Z `进程与端口核对`: 通过：安装版 PID 34404；当前源码开发版 PID 43004，ExecutablePath 为 D:\ai_proj\codem\src-tauri\target\debug\codem.exe；开发版监听 backend 3002、web 5174。
- 2026-07-15T10:48:49.749Z `Playwright + Windows 桌面检查`: 浏览器控制台 0 error；截图对应 Web 历史已进入后续回答，无法复现原运行中卡片；桌面窗口检查因检测到用户正在操作而停止，不抢占窗口。

- 2026-07-15T10:48:48.928Z `git diff --check`: 通过：无空白错误；仅工作区既有 LF/CRLF 提示。
- 2026-07-15T10:48:48.079Z `npm run typecheck`: 通过：TypeScript 工程类型检查无错误。

- 2026-07-15T10:48:47.093Z `node --import tsx --test src/components/ConversationPane.render-perf.test.ts`: 通过：3/3；Provider 透传未破坏 memoized turn 的稳定回调和时钟更新约束。
- 2026-07-15T10:48:46.077Z `node --import tsx --test src/lib/conversation.test.ts`: 通过：8/8；新增覆盖 Claude 旧选项事件、非 Claude 协议边界、isOther 和无选项文本题。

- 2026-07-15T10:32:50.629Z `Playwright 内联提问卡片验收`: 通过：卡片位于聊天流内，显示自定义回答；单选与文本双向互斥；控制台 0 error / 0 warning。
- 2026-07-15T10:32:49.827Z `npm run typecheck && cargo fmt --manifest-path src-tauri/Cargo.toml --check && git diff --check`: 分别执行均通过；diff check 仅有工作区既有 LF/CRLF 提示。

- 2026-07-15T10:32:48.965Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 117 passed、1 ignored（需真实 Grok 登录）；desktop 9 passed；doc tests 通过。
- 2026-07-15T10:32:48.179Z `node --import tsx --test src/lib/conversation.test.ts`: 通过：7/7，覆盖单选互斥、多选组合和已提交答案恢复。

## Completion Summary
- 2026-07-15T11:32:38.464Z 确认自定义回答源码实现有效，用户截图未更新的真实原因是测试窗口属于旧安装版。已启动当前仓库 CodeM Dev（3002/5174），在相同历史提问卡片中验证 textarea 与提示文字均存在；安装版未关闭，避免打断用户当前操作。

- 2026-07-15T10:48:50.559Z Claude 结构化提问的自定义回答已兼容旧事件：当前 Provider 明确传入提问卡片，Claude 选项题无需 isOther 也会显示输入框；其他 Agent 未声明 isOther 时不显示。定向测试、性能约束测试、类型检查和 diff 检查均通过。
- 2026-07-15T10:35:30.643Z Claude 结构化选项提问已在现有聊天内联卡片中支持自定义回答；单选预设与文本双向互斥，多选可组合提交，Rust bridge 保留自定义内容；回归测试、类型/格式检查、全量 Rust 测试和 Playwright 验收均通过。

## Follow-ups

- Codex 或 ACP Agent 如需自定义回答，应先在 provider capability 中声明并同步其原生协议校验。
