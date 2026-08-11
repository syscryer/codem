# Task: 简化 Agent Mux 能力元数据

## Background

Agent Mux 运行配置目前把“主执行 / 故障切换 / 备用”等工作流调度角色混入 Profile，同时能力标签按 Agent 类型写死且粒度不一致。Profile 本身只需要描述模型能力，调度职责应留给后续工作流配置。

## Objective

将 Profile 配置收敛为五级能力、能力偏向和具体用途，并保持数据库、实时发现与界面一致

## Scope

In scope:

- 能力等级统一为基础、轻量、标准、高级、顶级五档，并使用白、绿、蓝、紫、金标识。
- Profile 编辑器收敛为“能力等级 / 能力偏向 / 用途”三个标准下拉。
- 能力偏向使用通用、代码、前端 / UI、写作、数学推理五类宽泛模型倾向。
- 用途使用具体任务类型，不表达工作流调度角色。
- 保持现有 SQLite 字段与对外 JSON 兼容，并显式迁移旧四级、旧标签和旧用途值。
- 同步 Agent Mux Skill 的字段语义，使外部 Agent 可实时发现并正确选择 Profile。

Out of scope:

- 工作流编排、主执行/备用/审查 Agent、故障切换等调度角色。
- 新增数据库表或迁移字段。
- 根据标签自动执行工作流路由。

## Impact

- 前端 Profile 类型、编辑抽屉、配置列表和 Skill 说明。
- 后端 Profile 元数据规范化与旧数据兼容。
- Agent Mux 前端与 Rust 回归测试。

## Acceptance Criteria

- [x] 新建和编辑 Profile 时只展示三个统一风格下拉：能力等级、能力偏向、用途。
- [x] 五级能力以文本和对应颜色圆点共同展示，不能只靠颜色区分。
- [x] Profile 只保存一个能力偏向；用途为具体任务类型，不再出现工作流调度角色。
- [x] 旧的未评级、旧能力标签和旧用途读取后可被确定性转换，不静默吞掉非法的新输入。
- [x] `/agents` 实时目录可获得规范化后的 `level`、`tags`、`role` 数据。
- [x] 前后端类型检查、构建和相关测试通过。

## Verification Commands

- `node --import tsx --test src/lib/agent-mux-ui.test.ts`
- `npm run typecheck`
- `npm run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux`
- `git diff --check`

## Implementation Record
- 2026-08-11T10:07:27.399Z Agent Mux Profile 已收敛为能力等级、能力偏向、用途三个标准下拉；五级使用白绿蓝紫金圆点；后端复用现有字段并对旧四级、旧标签和旧调度用途做确定性迁移，新未知值返回真实校验错误。

- 2026-08-11T09:48:31.330Z Task created by Trellis automation.

## Verification Results
- 2026-08-11T10:07:27.685Z `node --import tsx --test src/lib/agent-mux-ui.test.ts; npm run typecheck; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo test --manifest-path src-tauri/Cargo.toml agent_mux; git diff --check`: 通过：21 个 Agent Mux UI 测试、TypeScript 类型检查、Vite 生产构建、Rust 格式检查、21 个 Agent Mux 相关 Rust 测试及 diff 检查。桌面开发模式已重启，Runtime identity 返回 200，CLI agents --json 已确认实时目录输出规范化 level/tags/role。

## Completion Summary
- 2026-08-11T10:07:27.978Z 完成 Agent Mux 能力元数据简化：五级能力、宽泛能力偏向、具体用途、旧数据兼容、Skill 语义同步及回归验证。

## Follow-ups

- 工作流阶段再定义调度角色与故障切换策略。
