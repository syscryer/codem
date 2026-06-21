# CodeM 合规整改清单:与 claudinal(AGPLv3)的版权隔离

> 交接给执行方(codex)的工作清单。每项含「位置 / 动作 / 验收」,按顺序执行。

## 0. 背景与原则(必读)

- **事实**:参考项目 `D:\ai_proj\claudinal` 采用 **GNU AGPLv3**(强 copyleft + 网络服务条款第 13 条)。CodeM 当前**无 LICENSE 文件**,`package.json` 无 `license` 字段(法律上默认 All Rights Reserved),且**会发布二进制分发**(`package:win/mac/linux`、`desktop:build`、自动更新)。
- **已确认的低风险信号**:本次未提交的三个功能点(软中断 / ultracode / hook-events)在源码层面**未逐字复制** claudinal 表达 —— 常量命名改写(`INTERRUPT_FALLBACK_MS` → `CLAUDE_INTERRUPT_FALLBACK_MS`)、注释自写、Rust→TS 重写;核心协议 `control_request{subtype:"interrupt"}` 属于 **Claude CLI 公开 stdio 协议**,非 claudinal 原创,不受版权保护。
- **四条原则**(贯穿全部整改):
  1. 只对接 **Claude CLI 官方公开协议 / 文档**,不把 claudinal 源码当实现依据。
  2. 思路、算法、交互模式、协议格式可参考(思想-表达二分法,不受版权保护);**受保护的代码表达(语句、结构序列、注释文案)不照搬**。
  3. 凡已落地且对齐 claudinal 的模块,**必须做表达相似度审计**;高度相似的须 clean-room 重写。
  4. 内部文档不得保留"搬运 / 照抄 claudinal"类措辞 —— 它们是书面证据,削弱 clean-room 抗辩。

---

## 1. 决策前置(人工决策,阻塞 P0)

**必须先由人定, codex 不要替定**:

- **D1. CodeM 最终采用何种协议?** 候选:
  - (a) 宽松开源(MIT / Apache-2.0)→ 必须保证**无任何** AGPL 衍生代码,否则违约。
  - (b) 接受 AGPLv3 → 整个 CodeM 以 AGPLv3 开源,所有用户可索取全部源码(含后续修改)。
  - (c) 闭源/私有 → 必须保证零 AGPL 衍生,且不分发(或仅内部用)。
- **D2. 是否有商业化/闭源打算?** 若有 → AGPL 是红线,只能走 (a) 或 (c),且必须 clean-room。

> 决策输出后填入下方 P0-1 / P0-2。P1 审计不依赖该决策,可先行。

---

## 2. P0 执行项(依赖 §1 决策)

### P0-1 补齐 LICENSE 文件
- **位置**:仓库根 `LICENSE`(当前不存在)。
- **动作**:按 §1-D1 选定协议写入对应协议全文(MIT/Apache 为短文本;AGPL 为 FSF 全文 + 头部署名)。
- **验收**:根目录存在 `LICENSE`;内容与选定协议一致;若选 AGPL,需含版权声明行。

### P0-2 声明 license 字段
- **位置**:`package.json`(无 `license` 字段);`src-tauri/Cargo.toml`(检查是否有 `license` 字段)。
- **动作**:在 `package.json` 顶层加 `"license": "<SPDX>"`(如 `"MIT"` / `"Apache-2.0"` / `"AGPL-3.0-only"`);同步 `src-tauri/Cargo.toml` 的 `license` 字段;检查 `src-tauri/tauri.conf.json` 是否有协议相关元数据需同步。
- **验收**:`npm`/`cargo` 元数据能正确识别 license;与 `LICENSE` 文件一致。

### P0-3 收敛内部文档措辞
- **位置**(4 个文档,均已确认含 "claudinal / 借鉴" 字样):
  1. `openspec/chat-input-content-blocks-and-attachments.md`
  2. `docs/superpowers/plans/2026-05-13-plugin-suite-implementation.md`
  3. `docs/superpowers/specs/2026-05-13-plugin-suite-design.md`
  4. `docs/superpowers/specs/2026-05-27-runtime-flavor-packaging-design.md`
- **动作**:把"Bring Claudinal's ... into CodeM""借鉴 claudinal""参考 `D:\...\claudinal`"等表述,改写为中性的、以 **Claude CLI 公开能力 / CodeM 自身需求**为来源依据的措辞。例如:
  - "搬运 Claudinal 的插件管理" → "CodeM 实现插件管理(对接 `claude plugin` CLI 子命令)"。
  - "桥接协议借鉴 claudinal" → "按 Claude CLI stdin stream-json 协议设计 content blocks 桥接"。
  - 删除指向 claudinal 源码路径的引用(`D:\...\claudinal` 字样)。
- **边界**:只改"来源/借鉴"类措辞;保留客观技术描述。
- **验收**:`grep -ri "claudinal" openspec docs` 返回空(或仅剩历史 changelog 类必要引用,需逐条标注理由)。

---

## 3. P1 代码表达相似度审计(可并行,不阻塞 §1)

> 目的:确认已落地模块有没有复制 claudinal 的**受保护表达**。**审计本身不改代码**,产出"高风险相似点清单",交回人工/P2 决定如何处理。

### P1-0 审计通用方法(给 codex 的 SOP)

对每个待审模块,执行三步:

1. **定位 claudinal 对应实现**:`D:\ai_proj\claudinal` 下找功能等价的源文件(前端组件、Rust 命令、reducer)。
2. **逐维比对**(按风险从高到低):
   - **注释文案**:中文/英文注释是否整句雷同(最高危,直接复制表达)。
   - **结构序列**:函数/分支/状态机的排列顺序是否照搬。
   - **命名**:标识符是否仅做了"换皮"(如 `interruptTimer`→`interruptFallbackTimer`)而结构不变。
   - **字面量/魔法值**:非协议约定的常量、错误文案、UI 文案是否雷同。
3. **判定**:
   - 🟥 **高风险**:存在 ≥10 行连续表达高度相似(换皮不换结构),或注释整段雷同 → 进 P2 clean-room 重写。
   - 🟧 **中风险**:局部结构相似但表达独立 → 标注,建议重构差异化。
   - 🟩 **低风险**:仅功能对齐、协议对接、表达独立 → 保留,无需处理。

输出格式:每模块一份表格 `codem 文件:行 | claudinal 对应 | 相似维度 | 等级 | 建议`。

### P1-1 plugin-suite 审计(最高优先)

- **已落地文件**(确认存在):
  - 前端:`src/components/settings/plugins/PluginsSuite.tsx`、`InstalledPluginsPanel.tsx`、`MarketplacesPanel.tsx`、`DiscoverPluginsPanel.tsx`
  - 前端逻辑:`src/lib/plugins.ts`、`src/lib/plugin-error-hints.ts`
  - 后端:`server/lib/plugins.ts`、`server/lib/plugins.test.ts`
  - 其他命中:`src/styles.css`、`server/index.ts`、`src/types.ts`
- **claudinal 对应**:在 `D:\ai_proj\claudinal\src` 与 `src-tauri\src` 下定位 plugin / marketplace / skill 相关组件与命令。
- **重点**:这是设计文档明确"full experience 搬运"的模块,**最可能存在表达相似**,必须逐文件 P1-0 三步审计。
- **验收**:产出该模块完整相似点表;标注每个文件等级。

### P1-2 content-blocks 桥接层审计

- **已落地文件**:`src/lib/input-content-blocks.ts`、`src/lib/claude-run-attachments.ts`、`server/lib/claude-service.ts` 中的 `normalizeStreamInputContentBlocks` 相关、相关 `.test.ts`。
- **claudinal 对应**:其发送层 / content blocks 桥接代码。
- **注意**:`openspec/...content-blocks-and-attachments.md` 自述"桥接协议借鉴 claudinal"——重点审**桥接层结构**,但 **Claude stdin message 协议本身**(type/role/content blocks 字段)是公开协议,不算抄袭。
- **验收**:产出相似点表。

### P1-3 本次三功能点(低风险,做防御性加固)

- **范围**:`server/lib/claude-service.ts` 的 `interruptRun` / `buildClaudeInterruptControlRequestMessage` / ultracode 分支 / `--include-hook-events`;`src/hooks/useClaudeRun.ts` 的 stopRun 中断逻辑。
- **动作**(已确认低风险,仅需加固):
  - 给入站 `control_response` 加**显式忽略分支** + 单测(对标 claudinal `reducer.ts:106` 的做法,但用 CodeM 自己的实现):在 `handleClaudePayload`(`claude-service.ts:1907`)内,`payload.type === 'control_response'` 时直接 `return`(不入队)。补一条测试锁定"CLI 回的 interrupt 协议回执绝不渲染"。
  - 复核 ultracode `--settings` 传参是否与 CodeM 其它 settings 用法冲突(已确认仅此一处用 `--settings`,无冲突 → 记录结论即可)。
- **验收**:新增忽略分支 + 通过的单测;`npm run typecheck` 通过。

### P1-4 全仓巡检

- **动作**:`grep -ri "claudinal" src server src-tauri`(排除 node_modules)应返回空;再对 `src`、`server` 做一次与 claudinal 的粗粒度结构比对,捕获 §3 未列出的遗漏借鉴点。
- **验收**:源码区无 claudinal 残留引用;遗漏点补入审计表。

---

## 4. P2 根据审计结果处理(依赖 P1 输出)

对 P1 标为 🟥 高风险的模块,执行 **clean-room 重写**:

- **SOP**:
  1. 由**未读过 claudinal 源码**的实现者执行重写(若由 codex 执行,需明确不读取 `D:\ai_proj\claudinal`)。
  2. 实现依据仅限:Claude CLI 官方文档、CodeM 自身行为需求文档(描述行为,不含 claudinal 代码)。
  3. 重写后保留"依据来源"记录(只引用 CLI 文档 / 需求),形成 clean-room 证据链。
- **替代方案**:若重写成本过高且 §1-D1 选了 (b) AGPL,则改为合规开源(整个 CodeM AGPLv3),无需 clean-room。
- **验收**:重写模块通过原测试;再次 P1-0 比对降为 🟩;过程证据归档。

---

## 5. 总验收清单

- [ ] §1 决策已定并记录
- [ ] 根目录 `LICENSE` 存在且与决策一致
- [ ] `package.json` / `Cargo.toml` license 字段已填
- [ ] `grep -ri "claudinal" openspec docs src server src-tauri`(排除 node_modules)结果可解释(无"搬运/借鉴"措辞残留)
- [ ] P1 各模块相似点表已产出
- [ ] 🟥 高风险项已 clean-room 重写或已走 AGPL 合规开源
- [ ] P1-3 入站 `control_response` 显式忽略 + 单测通过
- [ ] `npm run typecheck` 通过
- [ ] (若分发)确认分发形态与所选协议不冲突

---

> 备注:本清单为工程视角的风险识别与整改 SOP,不构成法律意见。涉及分发与商业化的最终决策建议咨询专业法律意见。
