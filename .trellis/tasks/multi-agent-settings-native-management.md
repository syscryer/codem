# Task: 多 Agent 原生设置管理

## Background

CodeM 已经接通 Claude Code、OpenAI Codex 与 Grok Build 的会话运行链路，但设置数据面仍主要围绕 Claude Code：插件页只调用 Claude CLI，MCP 写入只覆盖 Claude 配置，全局提示词固定读取 CLAUDE.md，CLI 版本页也只有 Claude 的完整信息。Skills 后端虽然能够扫描部分 Codex 目录，但页面没有 Provider 语义，安装仍固定写入 .claude/skills。

本任务参考 CC Switch 的 Provider 分治模型，但保持 CodeM 作为桌面壳的边界：不建立新的配置单一事实源，不自动搬迁或同步用户配置，直接管理各 Agent 原生 CLI 和原生目录。

## Objective

让设置界面完整管理 Claude Code、OpenAI Codex 与 Grok Build 的原生 CLI、Skills、插件、MCP、使用情况和全局规则，同时保持各 Agent 配置就地存储

## Scope

In scope:

- 建立设置页共享的 Agent 作用域选择器和 Provider 原生能力描述。
- 为 Claude Code、OpenAI Codex、Grok Build 提供版本、命令路径、认证/连接、更新和诊断信息。
- 分别扫描、导入、删除和打开三类 Agent 的用户级/项目级 Skills；跨 Agent 复制必须显式选择目标。
- 插件与 Marketplace 共用界面框架，但分别调用 claude/codex/grok 原生 plugin CLI。
- MCP 使用统一内部模型，分别读写 Claude JSON、Codex TOML、Grok TOML，并保留用户级/项目级作用域和 Provider 专属字段。
- 补齐 Codex/Grok usage 事件到 CodeM 消息统计，使用情况页支持按 Agent 筛选和能力差异展示。
- 全局规则页分别管理 Claude CLAUDE.md、Codex AGENTS.md/rules 和 Grok 原生 rules 文件。
- 所有写操作使用临时文件与原子替换或原生 CLI；失败时保留原配置，不写入半截文件。

Out of scope:

- 不接管或展示 auth.json、API key、OAuth token、MCP OAuth 凭据等敏感认证内容。
- 不把 Skills/MCP/插件搬到 CodeM 私有目录作为唯一数据源。
- 不默认自动同步不同 Agent 的配置，也不在热会话运行中改写 Provider 配置。
- 不把 Claude、Codex、Grok 的插件协议伪装成完全兼容；不支持的动作在 UI 明确禁用。
- 不接入新的 Agent Provider。

## Impact

- Frontend：设置页 Provider 作用域、CLI 诊断、Skills/插件、MCP、使用情况和全局规则页面。
- Backend：新增 Provider 原生设置服务与 API，扩展现有 usage 事件映射和配置读写。
- Persistence：复用 CodeM SQLite 消息 usage 字段；Provider 配置仍保存在各自原生目录。
- Security/privacy：API 仅返回脱敏诊断和配置摘要，不返回凭据；trace 不记录配置全文和环境变量值。

## Acceptance Criteria

- [x] 三个设置作用域均显示正确厂商图标、安装状态、版本、命令路径和诊断能力。
- [x] Skills 能分别列出 Claude/Codex/Grok 的用户级和项目级来源，导入/删除不写错目录。
- [x] Claude/Codex/Grok 插件列表和 Marketplace 使用各自原生 CLI，能力不支持时不显示伪操作。
- [x] MCP 能分别读取和安全写回 Claude JSON、Codex TOML、Grok TOML，未知字段不丢失。
- [x] Codex/Grok 运行后的 token、缓存、耗时和可用 cost 能进入 CodeM 使用情况统计。
- [x] 使用情况页可按 Agent 筛选，旧 Claude 历史统计保持不变。
- [x] 全局规则页按 Agent 读写正确文件，项目规则与全局规则边界清楚。
- [x] 热会话、附件、审批、提问、队列和默认 Agent 功能无回归。
- [x] 桌面开发版真实操作三个 Agent 的只读和可逆写入流程通过。

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run typecheck`
- `npm run build`
- `node --test --import tsx` 运行设置、插件、MCP、Skills、usage 与多 Agent 路由相关测试。
- 使用本机 claude/codex/grok CLI 做插件、MCP、Skills 和诊断真实探针。
- 桌面开发模式验证三个 Provider 设置页、窄屏布局和配置变更后的即时刷新。
- `git diff --check`

## Implementation Record
- 2026-07-13T19:40:32.330Z 完成最终审计补强：新增三 Agent 脱敏设置诊断接口与原生诊断按钮；修复通用 Agent totalCostUsd 未持久化；Skills 覆盖改为 staging/backup/rollback；补齐 macOS Tauri feature 和当前内嵌 Rust 后端测试断言。

- 2026-07-13T19:14:36.294Z 完成三 Agent 原生设置适配：共享 Provider 切换、CLI 诊断、插件与 Marketplace 能力分治、Skills 安装删除打开及显式跨 Agent 复制、MCP JSON/TOML 安全读写、用户级与项目级规则、Usage 事件和 Provider 筛选。
- 2026-07-13T18:16:24.671Z 完成三 Agent 原生设置能力盘点并确定架构：CodeM 就地管理 Claude/Codex/Grok 原生配置；共享 Provider 作用域和内部模型，插件走各自 CLI，MCP/Skills/规则按原生目录读写，usage 复用 CodeM SQLite；禁止读取凭据和自动跨 Agent 同步。

- 2026-07-13T18:15:09.184Z Task created by Trellis automation.

## Verification Results

- 2026-07-13T19:40:33.255Z `真实诊断、Skills 覆盖与窄屏 UI`: 三 Agent 静态诊断 215-476ms；Codex doctor 真实返回退出码1并在 UI 展示，Grok inspect 通过；三 Agent 用户级覆盖和项目级安装删除无残留；760px 窄屏无水平溢出。
- 2026-07-13T19:40:32.951Z `node --test --import tsx 全部 src/**/*.test.ts`: 通过：431 passed，0 failed。

- 2026-07-13T19:40:32.623Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 58 passed、1 ignored；main 9 passed；无失败。
- 2026-07-13T19:14:37.246Z `真实 API 与桌面 UI 探针`: Claude/Codex/Grok Skills 可逆安装删除通过；Codex/Grok MCP TOML round-trip 保留非 MCP 配置；三 Agent 用户级/项目级规则可逆写入通过；Codex/Grok 真实对话产出 usage；Usage UI Agent 筛选与插件技能布局通过。

- 2026-07-13T19:14:36.950Z `npm run typecheck && npm run build && git diff --check`: 全部通过；Vite 仅保留既有大 chunk 警告。
- 2026-07-13T19:14:36.634Z `cargo test --manifest-path src-tauri/Cargo.toml`: 通过：lib 56 passed、1 ignored；main 9 passed；无失败。

## Completion Summary

- 2026-07-13T19:40:33.559Z 完成多 Agent 设置目标的逐项完成审计和补强，所有自动化门禁、真实 API/CLI、可逆写入和桌面 UI 验收通过。
- 2026-07-13T19:14:37.552Z 完成 Claude Code、OpenAI Codex、Grok Build 设置数据面的原生适配和真实验收，桌面开发模式已重启并保持运行。

## Follow-ups

- 后续新增 Provider 时只实现 Provider 设置适配器和能力描述，不复制整套页面。
