# CodeM 第三方开源合规整改清单

> 交接给执行方的工程清单。每项含「位置 / 动作 / 验收」,按顺序执行。本清单用于降低第三方开源许可证和表达相似度风险,不把 CodeM 的功能来源绑定到任何单一外部项目。

## 0. 背景与原则

- **事实**:CodeM 当前无根目录 `LICENSE` 文件,`package.json` 无 `license` 字段,且项目包含桌面二进制分发和自动更新链路。
- **边界**:Claude CLI 的公开命令、公开 stdio 协议和通用产品交互模式可以作为实现依据;第三方项目中的具体代码表达、注释、结构序列和 UI 文案不能直接复制。
- **原则**:
  1. 实现依据优先写成 CodeM 自身需求、Claude CLI 公开能力和公开文档。
  2. 内部文档避免使用来源绑定或复制式措辞。
  3. 如果某个模块确实需要参考第三方实现,先做许可证兼容性判断,再做表达相似度审计。
  4. 需要重写时采用 clean-room:重写者只读 CodeM 需求和公开文档,不读高风险参考源码。

## 1. 决策前置

以下决策必须由维护者确认,执行方不要替定:

- **D1. CodeM 最终采用何种协议?**
  - 宽松开源,例如 MIT 或 Apache-2.0:必须确保没有强 copyleft 衍生代码。
  - 强 copyleft 开源:需要接受对应协议对源码公开和分发的要求。
  - 私有或内部使用:仍需保证第三方许可证兼容,并控制分发范围。
- **D2. 是否有商业化或闭源分发打算?**
  - 如果有,高风险第三方表达必须 clean-room 重写或移除。

P1 审计不依赖上述决策,可以先行。

## 2. P0 执行项

### P0-1 补齐 LICENSE 文件

- **位置**:仓库根 `LICENSE`。
- **动作**:按 D1 选定协议写入对应协议文本。
- **验收**:根目录存在 `LICENSE`;内容与选定协议一致。

### P0-2 声明 license 字段

- **位置**:`package.json`;`src-tauri/Cargo.toml`。
- **动作**:补充与 `LICENSE` 一致的 SPDX license 字段。
- **验收**:npm 和 Cargo 元数据能识别 license。

### P0-3 收敛内部文档措辞

- **位置**:
  - `openspec/chat-input-content-blocks-and-attachments.md`
  - `docs/superpowers/plans/2026-05-13-plugin-suite-implementation.md`
  - `docs/superpowers/specs/2026-05-13-plugin-suite-design.md`
  - `docs/superpowers/specs/2026-05-27-runtime-flavor-packaging-design.md`
- **动作**:
  - 把具体外部项目名、本地路径和来源绑定措辞改为中性表述。
  - 使用「CodeM 自身需求」「Claude CLI 公开能力」「成熟桌面客户端常见交互」等表达。
  - 保留客观技术边界,不为了措辞收敛而删除真实合规风险。
- **验收**:针对具体外部项目名、本地路径和复制式措辞的扫描无需整改命中为 0。

## 3. P1 代码表达相似度审计

> 目的:确认已落地模块有没有复制第三方项目的受保护表达。审计本身不改代码,只产出风险清单。

### P1-0 通用方法

对每个待审模块执行三步:

1. **定位功能等价实现**:只在审计阶段由指定审计者查找第三方项目中的等价功能。
2. **逐维比对**:
   - 注释文案是否整句雷同。
   - 函数、分支、状态机的排列顺序是否高度一致。
   - 标识符是否只是换名但结构不变。
   - 非协议约定常量、错误文案、UI 文案是否雷同。
3. **判定**:
   - 🟥 高风险:连续表达高度相似或注释整段雷同,进入 P2 clean-room 重写。
   - 🟧 中风险:局部结构相似但表达独立,建议重构差异化。
   - 🟩 低风险:仅功能对齐、协议对接、表达独立,保留。

输出格式:`CodeM 文件:行 | 等价功能来源 | 相似维度 | 等级 | 建议`。

### P1-1 Plugin Suite 审计

- **范围**:
  - `src/components/settings/plugins/*`
  - `src/lib/plugins.ts`
  - `src/lib/plugin-error-hints.ts`
  - `server/lib/plugins.ts`
  - `server/lib/plugins.test.ts`
  - `server/index.ts`
  - `src/types.ts`
- **重点**:插件、市场、技能发现和安装流程是否存在高度相似的结构序列、文案或命名。
- **验收**:产出每个文件的相似点表和风险等级。

### P1-2 Content Blocks 桥接层审计

- **范围**:
  - `src/lib/input-content-blocks.ts`
  - `src/lib/claude-run-attachments.ts`
  - `server/lib/claude-service.ts` 中 content blocks 归一化与 stdin 转换相关逻辑
  - 相关测试
- **注意**:Claude stdin message 字段、role/type/content blocks 等公开协议格式属于公开接口,不作为相似风险本身。
- **验收**:产出相似点表。

### P1-3 运行控制功能点

- **范围**:
  - `server/lib/claude-service.ts` 的软中断、ultracode、hook events 相关逻辑
  - `src/hooks/useClaudeRun.ts` 的停止按钮和中断状态逻辑
- **建议加固**:
  - 给入站 `control_response` 加显式忽略分支和单测,避免未来未知事件渲染兜底把协议回执显示成脏行。
  - 复核 ultracode `--settings` 传参与 CodeM 其它 settings 用法是否冲突。
- **验收**:新增测试通过,并记录结论。

### P1-4 全仓巡检

- **动作**:
  - 扫描 `openspec docs src server src-tauri` 中的具体外部项目名、本地路径和复制式措辞。
  - 对 `src`、`server` 做粗粒度结构审计,捕获 P1 未列出的遗漏点。
- **验收**:源码区无具体外部项目残留引用;遗漏点补入审计表。

## 4. P2 根据审计结果处理

对 P1 标为 🟥 高风险的模块执行 clean-room 重写:

1. 重写者不读取高风险参考源码。
2. 实现依据仅限 Claude CLI 公开文档、CodeM 需求文档和审计输出中的行为描述。
3. 重写后保留依据来源记录。
4. 原测试通过后再次审计,风险等级降为 🟩。

如果维护者选择了强 copyleft 兼容路径,则按对应协议完成源码公开、NOTICE、分发说明等合规动作。

## 5. 总验收清单

- [ ] 协议决策已记录。
- [ ] 根目录 `LICENSE` 存在且与决策一致。
- [ ] `package.json` 和 `src-tauri/Cargo.toml` license 字段已填。
- [ ] 文档中无不必要的具体外部项目绑定措辞。
- [ ] P1 各模块相似点表已产出。
- [ ] 🟥 高风险项已 clean-room 重写或已走对应许可证合规路径。
- [ ] 运行控制相关加固测试通过。
- [ ] 分发形态与所选协议不冲突。

> 备注:本清单为工程视角的风险识别与整改 SOP,不构成法律意见。涉及分发与商业化的最终决策建议咨询专业法律意见。
