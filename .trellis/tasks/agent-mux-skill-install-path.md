# Task: Agent Mux Skill 路径安装

## Background

Agent Mux 已能生成 `codem-agent-mux` 的完整 `SKILL.md`，但当前主流程要求用户复制整份文本，再手工创建目录和文件。该流程步骤多、容易放错目录，也无法在 CodeM 中看到各 Agent 的安装状态。用户确认希望参考统一资源管理界面：CodeM 自动识别本机 Agent，并可直接点击对应 Agent 完成安装。

## Objective

将 Agent Mux Skill 持久化到 CodeM 受管目录，按本机 Agent 展示安装状态并支持一键安装或更新，同时保留路径、完整预览与导出作为兜底。

## Scope

In scope:

- 按 `skill-creator` 约束生成仅包含 `name`、`description` frontmatter 的 `codem-agent-mux` Skill。
- 后端只写入 CodeM 应用数据目录下固定的 `skills/codem-agent-mux/SKILL.md`，不接受任意目标路径。
- 复用现有用户级 Skills 安装能力，支持 Codex、Claude Code、Grok Build、Pi Agent 和 OpenCode 的已知目录。
- 页面按 Agent 展示已识别、未安装、已安装和可更新状态，并支持单项安装、更新及批量安装。
- 已有内容被更新前必须明确确认，不能静默覆盖用户修改。
- 保留复制 Skill 源路径、复制完整内容和导出 `SKILL.md` 的兜底入口。
- 使用 CodeM 现有 Agent 品牌图标、主题变量和统一按钮反馈。

Out of scope:

- 不实现通用 Skill 市场、远程分发、自动更新守护进程或跨设备同步。
- 不接受用户输入任意安装目标目录。
- 不为 CodeM 尚未接入且没有确认 Skills 目录协议的其他 Agent 猜测安装路径；Grok Build 已通过 CC Switch 的公开实现确认使用 `~/.grok/skills`。
- 第一阶段不在 Agent 图标上提供删除开关；已安装状态只读，避免误触删除，卸载继续由现有 Skills 管理页负责。
- 不替代各 Agent 自身的 Skill 加载、刷新和权限机制。

## Impact

- Frontend: `src/components/AgentMuxPrototype.tsx`、`src/lib/agent-mux-api.ts`、`src/styles.css`。
- Backend: Agent Mux Skill 源文件同步接口及其路径/写入测试；继续复用 `/api/plugins/skills/install-from-path`。
- Local filesystem: CodeM 应用数据目录和已确认的 Agent 用户级 Skills 根目录。
- Security/privacy: 不保存渠道凭据，不把 API Key 写入 Skill；后端写入范围固定且安装覆盖必须显式确认。

## Acceptance Criteria

- [x] 打开 Agent Mux Skill 页面后，CodeM 自动生成并同步固定 Skill 源文件，页面显示实际绝对路径。
- [x] 页面展示 Codex、Claude Code、Grok Build、Pi Agent 和 OpenCode；可用目标能区分未安装、已安装和可更新。
- [x] 点击未安装 Agent 可直接安装到其用户级 Skills 目录，成功后立即刷新为已安装。
- [x] Skill 内容变化或用户目录已有不同内容时显示可更新，更新前需要用户确认。
- [x] 支持一次安装到所有已识别且支持 Skills 的 Agent，单项失败不伪装为整体成功。
- [x] 可以复制 Skill 源路径、复制完整内容并导出 `SKILL.md`。
- [x] 浅色/深色主题和窄窗口下布局可用，图标按钮具备可访问名称和状态提示。
- [x] 类型检查、前端测试、Rust 定向测试及真实浏览器与用户级目录验证通过。

## Verification Commands

- `npm run typecheck`
- `npm test -- --run`（若仓库测试入口可用）
- `cargo test --manifest-path src-tauri/Cargo.toml agent_mux_skill`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run desktop:dev` 后在 Agent Mux Skill 页面验证生成、安装、更新和状态刷新。

## Implementation Record

- 2026-08-05T03:47:04.901Z 已只读参考 MIT 项目 CC Switch（farion1231/cc-switch，commit 0345fad6048eed65b3423bedc8ce5711320ddfc3）的 UnifiedSkillsPanel、AppToggleGroup、AppCountBar 与 skill service：采用单 Skill、多 Agent 图标状态模型，真实同步完成后刷新安装状态；确认 Grok Build 用户级 Skills 目录为 ~/.grok/skills，因此纳入固定受支持目标。
- 2026-08-05T03:31:33.381Z 确认采用单 Skill、多 Agent 图标安装面板：Skill 源固定写入 CodeM 应用数据目录，Codex/Claude/Pi/OpenCode 复用现有用户级安装接口，Grok 不猜测目录；覆盖更新前明确确认。

- 2026-08-05T03:23:55.837Z Task created by Trellis automation.

## Verification Results

- 2026-08-05T04:07:43.356Z `浏览器 Agent Mux Skill 真实闭环（http://127.0.0.1:5174）`: PASS：Rust identity 经 Vite 代理返回；识别 5 个本机 Agent；Codex 单装成功；人工制造差异后显示可更新，取消确认不覆盖、确认后恢复一致；安装到全部后 5/5 已安装；复制路径/安装指令反馈正常；导出生成 blob:SKILL.md；620/820/1440 宽度无横向溢出，浅色/深色无重叠，控制台无错误。
- 2026-08-05T04:07:42.504Z `skill-creator quick_validate + SHA256 比对`: PASS：CodeM 源目录及 Claude Code、Codex、Grok Build、Pi Agent、OpenCode 五个安装副本均为有效 Skill；五个副本 SHA-256 全部与源文件一致。Windows 校验使用 PYTHONUTF8=1 规避上游脚本默认 GBK 读取。

- 2026-08-05T04:07:41.700Z `cargo test --manifest-path src-tauri/Cargo.toml agent_mux_skill -- --nocapture；cargo fmt --manifest-path src-tauri/Cargo.toml --check；git diff --check`: PASS：Agent Mux Skill 3 个 Rust 测试通过；Rust 格式与 diff whitespace 门禁通过，仅有既有 dead_code/linker 提示。
- 2026-08-05T04:07:40.784Z `npm run build；node --test --import tsx \ src/**/*.test.ts\`: PASS：生产构建成功；前端全量 729 passed、0 failed。

## Completion Summary
- 2026-08-05T04:08:15.469Z 完成 Agent Mux Skill 一键安装闭环：CodeM 固定源、五类 Agent 真实检测与状态比较、单项/批量安装、差异更新确认、复制与导出；参考 CC Switch 校准交互，skill-creator 校验通过。浏览器真实验证单装、取消/确认更新和安装到全部，五个目标文件均与源哈希一致；前端 729 项、Rust 定向 3 项、生产构建、格式和 diff 检查通过。

## Follow-ups

- 后续只有在目录协议明确后，才扩展当前五个目标之外的 Agent 一键安装支持。
