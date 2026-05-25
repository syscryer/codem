# Chat Input Content Blocks, @文件与附件体验需求

## Status

当前状态：需求方向已确认；第一阶段采用轻量闭环方案，进入实现前还需要确认具体任务拆分和验收命令。

本提案只定义需求边界、数据语义、交互预期和验收标准，不包含具体代码实现计划。

## Background

CodeM 当前已经补上了图片发送的关键链路：图片可以作为 Claude image block 进入 stdin，同时保留本地路径兜底，非多模态模型也能通过 `ViewImage` 路径处理。

但现有 API 和输入层仍偏向 `prompt + attachments`，图片、后续普通文件、`@文件`、PDF/Word 附件如果各自生长，会导致：

- 会话桥接层长期保留多套输入协议
- 队列、guide、重试、恢复会话容易丢附件语义
- 历史、debug、trace 容易误存 base64 或大文件全文
- UI 中图片、上传文件、项目文件引用割裂
- 非多模态模型与多模态模型的表现不一致

本次需求目标是一次性把输入语义理顺，后续实现可以分阶段，但方向不能妥协。

## Reference Findings

### claudinal

`D:\cursor_project\claudinal` 最值得借鉴的是桥接层的统一性：

- 所有输入先在前端转成 `contentBlocks`
- 文本、图片、PDF document 都走同一个 blocks 数组
- Tauri/Rust bridge 只做轻包装，原样写入 Claude `stream-json` stdin
- DOCX 提取文本内联，PDF 作为 document block，图片作为 image block
- 长粘贴文本转成 txt 附件，旧版 `.doc` 明确拒绝
- `@文件` 补全保持轻量，跳过 `.git`、`node_modules`、`target`、`dist`、`.next`、`.venv`、`venv`

不建议照搬的点：

- `<uploaded_file>` 文本包裹可以参考，但 CodeM 更适合用 first-class internal blocks 表达，不要把附件语义只压进 prompt 文本。
- 前端/Tauri 会话编排不需要迁移，CodeM 应继续沿用当前后端托管 Claude runtime 的架构。

### desktop-cc-gui

`D:\cursor_project\desktop-cc-gui` 最值得借鉴的是输入交互边界：

- ChatInputBox 对上传、粘贴、拖拽、文件树拖入、`@路径` 插入拆分清楚
- Windows 路径大小写、斜杠、`file://`、UNC 路径有专门归一化
- 图片路径和普通文件路径会分流，图片进入附件，普通文件进入 `@文件` 引用
- 防重复 drop、高 DPI 坐标、空 dataTransfer、跨窗口拖拽都有测试
- 附件列表支持本地路径预览和 base64/data URL 预览

不建议照搬的点：

- 整套 ChatInputBox 架构过重，和 CodeM 当前 Composer 不完全匹配。
- 它的发送层仍偏 `text + images`，不是完整统一 content blocks，桥接设计不如 `claudinal` 干净。

## Decision Direction

CodeM 采用组合方案：

- 桥接协议借鉴 `claudinal`：内部统一 `contentBlocks`，provider adapter 再转成 Claude stdin message。
- 输入交互借鉴 `desktop-cc-gui`：路径归一化、拖拽粘贴边界、去重、测试覆盖。
- Runtime 架构继续沿用 CodeM 当前后端托管方式，不迁移到 Tauri 直连 Claude runtime。
- 落地方式采用“协议中立，功能轻量”：现在只聚焦 Claude 的高频输入闭环，但内部模型不能绑定 Claude，后续接入其他 agent 时只新增 adapter。

## Final Recommendation

最终建议：架构地基一次做对，功能范围先做轻量。

第一阶段必须做：

- 建立 CodeM 自己的通用 `InputContentBlock`，不要使用 Claude 专用命名作为内部协议。
- `/api/claude/run` 继续兼容 `prompt + attachments`，但进入后端后统一 normalize 成 blocks。
- Composer 先支持文本、图片、小文本/代码文件、`@文件` 引用。
- 图片保持双路径：多模态走 image block，非多模态保留 `ViewImage` 路径兜底。
- `@文件` 做轻量版：当前 workspace 搜索、跳过常见大目录、小文本可内联、大文件只引用路径。
- 上传附件先支持图片和小文本/代码文件。
- 历史、队列、guide、重试、trace 都保存通用 blocks 的安全摘要，不存 base64 和大文件全文。
- 最后一层 `Claude adapter` 负责把通用 blocks 转成 Claude stdin 所需格式。

第一阶段暂缓：

- PDF document block。
- DOCX 文本提取。
- 长粘贴自动转附件。
- 跨窗口拖拽、高 DPI 拖拽、复杂文件树拖入。
- 用户手动切换“内联/仅引用”。
- 完整文件预览器或附件管理器。
- 重写 Composer 或搬运 `desktop-cc-gui` 的 ChatInputBox。

这能避免功能做重，同时避免把核心协议焊死在 Claude 上。

## Goals

1. 建立统一输入模型：文本、图片、上传附件、`@文件` 都先归一化为内部 `contentBlocks`；PDF/Word、长粘贴文本作为后续扩展能力预留。
2. 保持兼容：`/api/claude/run` 可以继续接收旧的 `prompt + attachments`，但后端入口必须 normalize 成 blocks 再进入 bridge。
3. 支持多模态与非多模态：模型支持多模态时发送 image/document block；不支持或能力未知时仍保留本地路径和工具读取兜底。
4. `@文件` 和上传附件共用同一套附件模型、同一套 UI 展示、同一套历史脱敏策略。
5. 队列、运行中 guide、重试、恢复会话必须保留附件语义，不能只保证普通发送路径。
6. 历史、debug events、raw events、trace 日志默认只存安全摘要，不存 base64、大文件全文或敏感文件内容。
7. UI 必须让用户看懂每个输入块的状态：已内联、仅引用、图片、文档、过大未内联、上传失败、待发送等。

## Non-Goals

- 不整体重写 Composer 或照搬 `desktop-cc-gui` 的 ChatInputBox。
- 不迁移到 `claudinal` 的 Tauri 会话管理方式。
- 不把所有二进制文件都强行转成 prompt 文本。
- 不在第一阶段实现复杂文件管理器或完整文件预览器。
- 不在第一阶段实现 PDF/DOCX 深度解析、长粘贴附件化、跨窗口拖拽等低频复杂能力。
- 不为了兼容旧链路继续扩散 `prompt + attachments` 作为内部核心协议。

## Core Model

内部建议采用 first-class `contentBlocks`，它是 CodeM 内部输入语义，不等同于最终 Claude API 原始 blocks。Provider adapter 负责把内部 blocks 转成目标模型可接受的 payload。

建议 block 类型：

- `text`：用户直接输入的文本。
- `image`：图片内容，包含 media type、名称、大小、本地保存路径；可临时携带 base64，但持久化时必须剥离。
- `document`：PDF 等模型可直接接收的文档内容；可临时携带 base64，持久化时只保留摘要和本地副本路径。
- `file_text`：小文本、代码、Markdown、DOCX 提取文本等已内联内容。
- `file_reference`：项目文件、大文件、图片路径、PDF/Word、二进制文件等引用型输入。
- `attachment_metadata`：无法内联或不能发送原文时的元信息块，说明文件名、类型、大小和原因。
- `tool_result`：继续保留现有工具结果消息语义，不和用户附件混在一起。

Provider adapter 规则：

- Claude 多模态路径：`text`、`image`、`document` 转成 Claude 支持的 content blocks。
- 非多模态或能力未知路径：保留文本说明和文件路径，让模型用合适工具读取；图片只能提示使用 `ViewImage`，不得提示用 `Read`、`Grep` 读取图片。
- 文件引用路径：优先传递可访问的绝对路径和简洁说明，不把大文件全文塞进 prompt。

## @文件需求

`@文件` 是项目文件引用能力，不只是往文本框插入字符串。

基本行为：

- 输入 `@` 时出现文件补全，支持按相对路径和文件名搜索。
- 选择文件后在 Composer 中展示为文件 chip，同时保留绝对路径映射。
- 用户手动输入合法 `@path` 时，也应尽量解析成同样的文件引用语义。
- 文件树拖入、外部文件拖入、粘贴文件路径，最终都走同一套解析与去重逻辑。

推荐扫描策略：

- 默认只扫当前 workspace。
- 跳过 `.git`、`node_modules`、`target`、`dist`、`.next`、`.venv`、`venv`、`.codem-attachments`。
- 搜索结果需要限制数量，建议上限 500。
- 对大仓库需要 debounce、缓存或后端分页，避免输入 `@` 时卡顿。

智能内容策略：

- 小文本、代码、Markdown 文件默认可内联为 `file_text`，建议默认阈值 1 MB，可配置或后续调整。
- 大文本文件默认 `file_reference`，UI 显示“过大未内联”。
- 图片文件生成 `image` block，并保留 `ViewImage` 路径兜底。
- PDF 优先生成 `document` 或 `file_reference`，取决于 provider 能力和文件来源。
- DOCX 可提取文本时生成 `file_text`，无法提取时生成 `file_reference` 或 `attachment_metadata`。
- 二进制和未知类型默认 `file_reference`，不尝试读成文本。

## 上传附件需求

上传附件与 `@文件` 必须共用同一套内部模型。

支持入口：

- 点击附件按钮选择文件。
- 粘贴图片或文件。
- 拖拽文件到 Composer。
- 长文本粘贴自动转为 txt 附件。

支持类型：

- 图片：`png`、`jpg/jpeg`、`gif`、`webp`，其他格式先按明确错误提示处理。
- PDF：优先作为 document block。
- DOCX：提取文本内联，旧版 `.doc` 明确提示用户另存为 `.docx` 或 PDF。
- 文本与常见代码文件：在阈值内内联。
- 其他二进制：默认不内联，只保留引用或提示不支持。

上传存储：

- 上传文件应复制到 workspace 下的 `.codem-attachments`，使用安全唯一文件名。
- 发送时可以短暂携带 base64；发送后、历史持久化、trace、debug 中都必须剥离。
- 如果文件只存在剪贴板或浏览器 File 对象中，应先落成本地副本，保证队列、guide、重试和恢复会话还能找到文件。

## Composer UI需求

Composer 需要统一展示所有输入块，而不是只展示图片缩略图。

必须展示的信息：

- 文件名或简短标题。
- 类型：图片、PDF、Word、文本、代码、项目文件、二进制。
- 大小。
- 状态：已内联、仅引用、图片、文档、过大未内联、上传中、上传失败。
- 来源：上传、粘贴、拖拽、`@文件`，来源可弱化展示，但内部语义要保留。

必须支持的操作：

- 删除单个输入块。
- 图片预览。
- 上传失败后重试或移除。
- 至少能区分“会发送内容”和“只给模型路径引用”。

推荐但可后续分阶段：

- 用户手动切换小文件“内联/仅引用”。
- 对已内联文本显示简短预览。
- 对 PDF/DOCX 显示提取状态。

## Bridge And Runtime Requirements

`/api/claude/run`：

- 继续兼容旧字段 `prompt` 和 `attachments`。
- 新增或预留 `contentBlocks`。
- 请求进入后第一步 normalize，之后内部只处理统一 blocks。
- 允许“只有附件没有文本”的消息，不再要求业务层必须拼默认 prompt；如果 provider 需要文本，由 adapter 生成最小说明。

Guide / Follow-up：

- `/api/claude/run/:runId/guide` 必须支持同样的 content blocks。
- guide 附件只属于本次 guide，不能泄漏到原始 turn 或后续 guide。

队列：

- 运行中发送的后续消息必须保存 blocks 语义。
- 队列预览只展示摘要，例如文本片段、图片数量、文件名，不展示 base64 或大文件全文。

重试与恢复：

- 已落地到 `.codem-attachments` 的文件可以通过路径重新构造发送 blocks。
- 如果文件丢失或不可访问，UI 应提示用户重新上传，不能静默发送缺失内容。

Trace：

- 只记录摘要，例如 `text=1, images=2, documents=1, references=3, imageBytes=...`。
- 不记录 base64、完整文件正文、绝对路径以外的敏感内容；必要时路径也应可脱敏。

## Persistence Requirements

历史记录中保存的是安全投影，不是完整发送 payload。

允许保存：

- 用户可见文本。
- 附件 id、名称、类型、大小、本地副本路径、引用路径、状态。
- block 类型和摘要。

禁止保存：

- 图片 base64。
- PDF/Word base64。
- 大文件全文。
- raw/debug/trace 中的完整附件内容。

恢复展示：

- 刷新后能看到用户当时发送了哪些附件或引用。
- 如果本地副本还存在，可以预览或用于重试。
- 如果文件不存在，显示“文件已不可访问”，不伪装为正常可用。

## Error Handling Requirements

必须给出明确错误：

- 文件类型不支持。
- 文件超过内联阈值。
- 文件读取失败。
- 上传保存失败。
- base64 无效。
- 本地路径不可访问。
- PDF/DOCX 提取失败。

错误提示要面向用户，不暴露冗长 MIME 或底层堆栈。

## Test Requirements

实现前需要准备或同步补充测试，至少覆盖：

- `prompt + attachments` 归一化到 content blocks。
- 新 `contentBlocks` 请求直接进入 bridge。
- 图片多模态 block 和 `ViewImage` 路径兜底同时存在。
- 非多模态或能力未知时不会提示用 `Read/Grep` 读图片。
- `@文件` 小文本内联、大文件引用、图片分流。
- 上传 PDF/DOCX/文本/图片的类型识别。
- 历史持久化剥离 base64 和大文件全文。
- trace 只输出摘要。
- 队列消息附件不丢。
- guide 附件隔离。
- 重试/恢复时文件缺失有明确提示。
- Windows 路径归一化、大小写去重、反斜杠/斜杠去重。
- `file://` 和 UNC 路径解析。
- 粘贴、拖拽、文件树拖入重复事件不会重复插入。

## Acceptance Scenarios

1. 用户只粘贴一张图片并发送：多模态模型收到 image block；非多模态路径仍能看到 `ViewImage` 路径提示；历史中不保存 base64。
2. 用户 `@src/App.tsx`：Composer 展示文件 chip；小文件进入 `file_text`；模型能看到文件内容和文件来源。
3. 用户 `@large.log`：Composer 展示“过大未内联”；模型收到文件引用路径，不把日志全文塞进 prompt。
4. 用户上传 PDF：Composer 展示 PDF 附件；支持 document block 时发送 document；不支持时保留文件引用和说明。
5. 用户上传 DOCX：能提取文本时以内联文本发送；旧版 `.doc` 提示另存为 `.docx` 或 PDF。
6. 用户拖入一个图片和一个代码文件：图片进入 image block，代码文件进入 `file_text` 或 `file_reference`，两者展示在同一附件栏。
7. 运行中继续发送带附件的 follow-up：进入队列后附件语义不丢，轮到发送时仍能正确构造 blocks。
8. guide 带图片：该图片只属于本次 guide，不污染原始 turn。
9. 刷新历史：能看到图片/文件卡片，但 raw/debug/trace 没有 base64。
10. 重试时本地附件被删除：UI 明确提示文件不可访问，要求重新上传。

## Open Questions Before Implementation

- 默认内联阈值是否采用 1 MB，还是按文件类型区分阈值。
- PDF 是否第一阶段就做 document block，还是先只做本地引用。
- DOCX 提取逻辑放前端还是后端，需结合 Web 版和桌面版能力决定。
- `@文件` 手动输入不存在路径时，是保留纯文本还是显示无效引用 chip。
- 是否需要用户手动切换“内联/仅引用”，如果需要，第一阶段是否必须实现。

## Implementation Gate

进入编码前必须满足：

- 用户确认本需求草案。
- 明确第一阶段范围，不把所有推荐项一次性塞进一个不可控改动。
- 明确受影响文件和接口 contract。
- 明确测试命令和验收场景。
- 明确哪些内容会进入历史，哪些只存在于本次发送的内存态。
