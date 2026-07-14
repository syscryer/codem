# Task: 普通聊天数据一致性加固

## Background

普通 AI 聊天完整链路已经落地并完成异常与资源生命周期加固。继续审计存储层时发现两类一致性风险：知识库查询会静默忽略 SQLite 行读取错误，知识库配置更新与全量重建也没有共享同一事务；模型存储则允许默认模型被禁用、删除默认模型后没有自动提升，以及已有启用模型但没有默认模型的状态。

## Objective

修复知识库查询与重建事务一致性，并收紧模型默认状态不变量

## Scope

In scope:

- 让知识库查询在 SQLite 行读取失败时明确返回错误，不静默丢失部分结果。
- 让独立重建在单一事务中更新全部来源、分块状态和知识库时间戳。
- 让修改切片配置与对应重建共享同一事务，失败时同时回滚配置和索引。
- 收紧模型状态：默认模型必须启用；每个存在启用模型的供应商恰好有一个默认模型。
- 创建、发现、更新、禁用和删除模型后都保持上述不变量，并修复既有异常状态。
- 为上述路径补充 SQLite 回归测试。

Out of scope:

- 不修改普通聊天设置页或 Agent 设置实现。
- 不重构 Provider vault 与 SQLite 的跨存储写入顺序。
- 不更换知识库嵌入算法、切片策略或增加新文件格式。
- 不增加供应商协议或改变前端模型选择交互。

## Impact

- Backend：`src-tauri/src/ordinary_chat/knowledge.rs`、`storage.rs` 和模型删除路由。
- Frontend：`useOrdinaryChat` 在聊天原模型被禁用或删除后派生到当前启用默认模型。
- Persistence：现有 `ai_knowledge_*` 与 `ai_models` 表的数据写入不变量；不新增 schema。
- Compatibility：前端继续使用当前 `preferredModel` 容错，接口响应结构不变。

## Acceptance Criteria

- [x] 知识库查询遇到损坏或类型错误的行时返回明确数据库错误。
- [x] 知识库重建任一步失败时，旧分块、来源状态和知识库时间戳不出现部分提交。
- [x] 修改切片配置后重建失败时，配置和索引一起回滚。
- [x] 默认模型始终为启用状态；存在启用模型时始终恰好一个默认模型。
- [x] 禁用或删除默认模型后自动提升另一个启用模型；没有启用模型时允许无默认模型。
- [x] 模型发现和手工新增可以修复已有模型但没有默认模型的状态。
- [x] 当前聊天引用的模型被禁用或删除后，前端选择与发送都回落到同供应商的启用默认模型。
- [x] 定向 Rust 测试、格式检查、TypeScript 和 Git 差异门禁通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml ordinary_chat --lib`
- `npm run typecheck`
- `git diff --check`
- `git diff --cached --check`

## Implementation Record
- 2026-07-13T22:51:19.444Z 完成普通聊天数据一致性加固：知识库查询不再吞错，独立重建与切片配置更新使用事务回滚；模型写入、禁用、删除和旧库初始化保持单一启用默认模型，前端同步回落到启用默认模型

- 2026-07-13T22:37:38.068Z Task created by Trellis automation.

## Verification Results
- 2026-07-13T22:51:20.914Z `隔离服务 5174/3101 与主工作区 5173/3001 健康检查`: 通过：隔离 health/bootstrap/Web 均 200，主工作区 health/Web 均 200

- 2026-07-13T22:51:20.630Z `git diff --check && git diff --cached --check`: 通过：无空白错误，仅 Windows 行尾提示
- 2026-07-13T22:51:20.341Z `npm run typecheck && npm run build`: 通过：TypeScript 与生产构建成功，仅保留既有 Tauri 动静态导入和大 chunk 提示

- 2026-07-13T22:51:20.034Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 82 通过、1 个真实 Grok 测试忽略；desktop main 9/9；backend bin 通过
- 2026-07-13T22:51:19.740Z `cargo fmt --check && cargo test ordinary_chat --lib`: 通过：普通聊天 28/28，新增知识库损坏行、事务回滚、模型默认提升与旧库修复回归

## Completion Summary
- 2026-07-13T22:51:31.696Z 完成普通聊天数据一致性加固：知识库查询显式传播 SQLite 行错误；独立重建和切片配置更新具备原子回滚；模型默认状态在创建、发现、禁用、删除和旧库初始化后保持一致，前端选择同步回落。Rust 全量、TypeScript、生产构建、Git 门禁和隔离服务健康检查通过。

## Follow-ups

- Provider vault 与 SQLite 无法真正跨介质原子提交，保持现有可恢复顺序，后续只有出现真实故障证据时再单独设计恢复协议。

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
| --- | --- | --- |
| 首次文档补丁引用了 `findings.md` 中不存在的历史标题，补丁校验失败 | 1 | 改为逐文件精确修改并在文件尾追加新记录 |
| 并行验证时误调用 `wait` 且传入不存在的 cell id | 2 | `wait` 只用于 `exec` 已返回的真实 cell；本轮改用实际命令执行验证 |
| 端口/健康检查把 `foreach` 结果直接接管道，PowerShell 报空管道解析错误 | 2 | 按项目既有经验先收集到数组，再统一格式化；后续命令不再使用该结构 |
| Windows 下给 `rg` 传入 `vite.config.*` 路径通配符时报文件名语法错误 | 1 | 不再传路径通配符；需要时先用 `rg --files -g 'vite.config.*'` 获取真实文件名 |
