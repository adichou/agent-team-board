# REQ-20260909-011 优化批量完善和批量开发的提示词，不再区分 Agent，使用通用的描述词。设置中去掉 Agent 的配置

- 状态：submitted（待人工接受）
- 创建：2026-09-09T08:43:25.412Z

## 描述

批量完善与批量开发的主调度提示词当前按执行 Agent（zcode / codex）维护两套差异化版本（REQ-20260908-020 引入），设置「批量任务」区也围绕 Agent 维度组织（Agent 展示/隐藏 + 「任务类型 × Agent」四路模型配置，经 REQ-20260908-026、REQ-20260909-001、REQ-20260909-005 演进）。实际两类任务均为同一子代理模式（主调度会话逐项派子代理 + 文件化短回执），按 Agent 分叉的提示词与配置带来的维护成本高于差异收益。

本需求要求：

1. **提示词通用化（不再区分 Agent）**：批量完善与批量开发各自只保留**一版通用主调度提示词**，同一任务类型的新建任务提示词完全一致。提示词中不再出现按 Agent 分支的段落与字样（zcode / Zcode / codex / Codex、general-purpose 子 Agent、codex exec 参数口径等），改用与执行端无关的通用描述词（如「主调度会话」「子代理」「当前会话」「执行端」），使同一份提示词可在任意一种 Agent 会话中直接粘贴执行。
2. **设置中去掉 Agent 的配置**：「设置 → 批量任务」区不再提供任何按 Agent 的配置——删除批量完善/批量开发两张 Agent 表格（执行 Agent 隐藏开关、按 Agent 的模型来源/子代理模型/推理强度列）及关联说明；与之联动的「全部隐藏禁用启动」逻辑一并移除。该区仅保留与 Agent 无关的「完善完成后自动转入计划」开关（REQ-20260909-010，默认关闭）。设置页其余区域（运行参数）不受影响。
3. **启动流程去 Agent 化**：两类任务的启动区（含终态「启动新一轮」）不再出现「执行 Agent」下拉与「选择执行 Agent…」空占位（BUG-20260908-016 引入的选择前置），也不再出现「设置中已隐藏全部执行 Agent」的禁用提示；点击「启动 / 启动新一轮」直接创建任务并复制通用主调度提示词（复制成功 ≠ 执行中，登记运行后才算执行中——该口径不变）。

### 现状依据（基于当前代码）

- **两套差异化提示词的生成点**：
  - 批量完善：`scripts/lib/refine-store.mjs` 的 `buildRefinePrompt`（约 354–419 行）——`agent === 'codex'` 分支输出「执行 Agent：codex。在 codex 会话中执行本提示词…子会话命名统一为：<条目编号>」，zcode 分支输出「执行 Agent：zcode。在 Zcode 本项目新建会话粘贴本提示词，每轮新启动一个 general-purpose 子 Agent…」；领取前缀 `byPrefix` 也按 Agent 差异化为 `codex-refine` / `zcode-refine`（BUG-20260908-013 口径）。
  - 批量开发：`scripts/lib/batch.mjs` 的 `generatePrompt`（约 463–510 行）——codex 分支与 zcode（general-purpose 子 Agent）分支段落不同。
  - 共用的跟随主会话指令 `FOLLOW_SESSION_PROMPT_LINE`（`scripts/lib/task-settings.mjs`）措辞已基本通用，但举例提及「codex exec 的 --model / model_reasoning_effort」，通用化时措辞需一并复核。
- **Agent 维度配置的存储与读取**：`scripts/lib/task-settings.mjs`（`agents` 展示列表 + `models` 四路 { source, model, level }，存于 `<dataDir>/tasks/settings.json`；`visibleAgents` / `modelConfigOf`）；服务端入口 `scripts/server.mjs` 的 `/api/tasks/settings`、`/api/batch/create`（读 `models.develop[agent]`）、`/api/refine/create`（读 `models.refine[mode]`）；CLI 入口 `scripts/atb.mjs` 的 `refine create --mode zcode|codex`（按 mode 取模型配置）。
- **设置界面**：`scripts/web/app.js` 的 `taskSettingsHtml` / `taskSettingsAreaHtml` / `bindSettingsView`（五列表格：执行 Agent / 模型来源 / 子代理模型 / 推理强度 / 是否隐藏；保存提交 agents + models）。
- **启动区 Agent 选择**：`scripts/web/app.js` 的 `renderDevStartBar`（`#devMode`）、批量完善启动区（`#refineMode`）、终态「启动新一轮」（`#devNextMode` / `#refineNextMode`）、`visibleTaskAgents`、`modelSourceText`；运行概况行的「执行 Agent xxx（子代理模式）」展示。
- 子代理模型默认口径已是「跟随主调度会话」（REQ-20260909-005，follow 为默认值），为设置中去掉按 Agent 手动覆盖提供了基础。

### 目标口径细化

1. **通用提示词内容**：仍完整保留既有调度要素——项目路径、批次/任务标识、开发人员会话命名（填写时）、CLI 约定（atb 指向）、每项一个子代理的领取/执行/回执流程、硬性约束（条目保持 accepted、不改业务源码、不 git commit 等）、`nextAction=continue / stop / needs_attention` 处置、批次排队接续（开发侧 nextBatch）、「跟随主调度会话」模型指令（沿用 REQ-20260909-005 默认语义，措辞通用化，不再点名具体执行端参数）。删除的仅是 Agent 分叉段落与会话/子会话命名的 Agent 专属口径。
2. **完善领取前缀通用化**：`atb refine next --by <前缀>-…` 的前缀不再按 Agent 二选一（zcode-refine / codex-refine），改为单一通用前缀（具体措辞由开发阶段定，如 `refine-<批次尾号>-<序号>`；前缀仅为会话标识字符串，不影响锁与账本语义）。
3. **设置区精简后形态**：「设置 → 批量任务」= 标题 + 一句说明（两类任务均为子代理模式、提示词通用、子代理模型默认跟随主调度会话）+「完善完成后自动转入计划」开关 + 保存按钮与就近状态反馈。保存仅提交流转开关；agents / models 不再有界面入口。
4. **生效范围**：仅影响**新建**任务（提示词创建时冻结进批次账本，进行中与历史任务保持原样）；存量批次/运行记录照常展示，历史提示词不回溯改写。

### 待确认（开发阶段 design.md 须给出结论）

- **模型手动覆盖能力是否保留**：设置去掉按 Agent 的模型配置后，「手动指定模型/档位」（REQ-20260909-005 的 manual 路径）是彻底移除（一律跟随主调度会话），还是保留一个不分 Agent、不分任务类型的通用手动覆盖入口。原始需求未明确；若彻底移除，提示词中的模型指令固定为「跟随主调度会话」。
- **存储与 API 兼容口径**：`tasks/settings.json` 的 `agents` / `models` 字段及 `/api/tasks/settings` 的 agents/models 参数是删除字段、保留忽略（兼容旧客户端），还是迁移清理；`atb refine create --mode` 与 `/api/refine/create`、`/api/batch/create` 的 mode/agent 入参如何处置（忽略、缺省化或废弃报错）。存量已保存的手动模型值是否迁移保留。
- **批次/运行账本的 `agent` / `mode` 字段**：新建任务是否仍记录（如固定记子代理模式标识）还是停写；运行概况行的「执行 Agent xxx（子代理模式）」对新批次如何展示（建议仅展示「子代理模式」）。存量记录展示不受影响。
- **隐藏的服务端 codex 后台路径**（`scripts/lib/scheduler.mjs` 的 `codex exec` 逐项路径、`buildRefineWorkerPrompt` 等）本期不动，还是顺带核对其中 Agent 专属文案；原始需求未明确，默认不动。

### 非目标（不做）

- 不改变两类任务的候选口径（完善=已接受未完善实时读取；开发=已计划最旧优先）、执行流程、回执协议、暂停/终止、完善三态标记与流转规则（REQ-20260908-020 / REQ-20260909-010 等既有口径）。
- 不删除任务、历史批次、运行记录与讨论数据；不改动设置页「运行参数」区；不新增执行模式。
- 不涉及 oncall（值班）等其它模块的提示词与配置。

## 界面布局

改动集中在三处（均为 `scripts/web/app.js`）：

1. **设置 → 批量任务**（`taskSettingsHtml` / `taskSettingsAreaHtml`）：删除批量完善、批量开发两张 Agent 配置表格；保留分区标题、一句通用说明、「完善完成后自动转入计划」开关、保存按钮与就近状态文字。
2. **批量开发启动区**（`renderDevStartBar`）与**批量完善启动区**（`renderRefinePanel` 无批次时）：去掉「执行 Agent」标签与下拉，保留开发人员输入、「启动」按钮、队列/候选预览说明；终态「启动新一轮」条（`#devNextMode` / `#refineNextMode`）同样去掉下拉仅留按钮。
3. **运行概况行**：去掉「执行 Agent xxx」中的 Agent 维度展示（新批次按「子代理模式」等通用口径，具体措辞见待确认项；存量批次展示不回溯）。

## 交互行为

- 启动 / 启动新一轮：无需任何 Agent 选择，点击即创建任务并复制通用主调度提示词（复制成功 ≠ 执行中；登记运行后才算执行中）；提示词可粘贴到任意一种 Agent 会话执行，会话/子会话命名由提示词内通用指令描述。
- 设置：仅「完善完成后自动转入计划」开关可编辑；切换只改草稿并提示「有未保存的更改」，保存成功后仅对后续新任务/回执生效；保存防重复提交。
- 随 Agent 配置移除而消失的交互：启动区 Agent 下拉与空占位校验、「设置中已隐藏全部执行 Agent」禁用与跳转提示、启动区随所选 Agent 变化的生效模型口径行（`modelSourceText`）。无候选时启动仍禁用并说明原因（该逻辑保留）。

## 状态反馈

- 正常：设置显示已保存的流转开关并回显；启动成功 toast 提示创建任务并复制提示词；任务面板提示词页签展示通用提示词全文。
- 加载：设置页沿用「正在加载任务设置…」骨架，禁用编辑与保存，防止未加载完成覆盖配置。
- 失败：设置加载失败显示错误 + 重试；保存失败保留草稿、显示错误可重试，不误报成功。
- 空状态：无已计划/可完善候选时启动区提示原因并禁用启动；「全部隐藏 Agent」一类提示不再存在（配置已移除）。
- 进行中/历史任务：不受本次改动影响，照常运行与展示。

## 界面展示

[打开可交互演示](./ui-demo.html)（单文件、内联 CSS/JS、无外网依赖、无构建步骤，浏览器直接打开）。演示覆盖：设置「批量任务」区目标形态（仅流转开关，含正常/加载/失败状态切换与保存反馈）、批量完善与批量开发启动区目标形态（无 Agent 选择，含有候选/无候选状态）、通用提示词与现行两套差异化提示词的对照查看。演示中的状态与提示词文案均为页面内存模拟，不写项目配置。

## 验收标准

- [ ] 批量完善新建任务生成的主调度提示词为单一通用版本：不出现 zcode / Zcode / codex / Codex 等执行端字样与按 Agent 分叉的段落；领取前缀为单一通用前缀（不再 zcode-refine / codex-refine 二选一）。
- [ ] 批量开发新建任务生成的主调度提示词同为单一通用版本，且保留调度要素：项目路径、批次标识、CLI 约定、每项一个子代理、回执与核对入口、nextAction 处置、排队接续（nextBatch）说明。
- [ ] 两类提示词仍包含模型口径指令，默认语义为「子代理模型与智能/推理档位跟随主调度会话」（REQ-20260909-005 口径），措辞不点名具体执行端；手动覆盖的存废按 design.md 对待确认项的结论实现并验证。
- [ ] 设置「批量任务」区不再出现执行 Agent 相关配置（隐藏开关、按 Agent 的模型来源/模型/推理强度表格及说明）；「完善完成后自动转入计划」开关保留且行为不变（默认关闭，保存后仅对后续回执生效）。
- [ ] 两类任务启动区与终态「启动新一轮」不再出现执行 Agent 下拉、空占位校验和「设置中已隐藏全部执行 Agent」类禁用提示；启动直接创建任务并复制通用提示词；无候选时仍禁用并说明原因。
- [ ] 存量兼容：进行中与历史批次/运行记录照常展示与运行（提示词创建时已冻结）；历史提示词不回溯改写；`tasks/settings.json` 存量字段与相关 API/CLI 参数的处置符合 design.md 结论，读不到 agents/models 配置时不报错、不阻断启动。
- [ ] 涉及的既有测试（如 `task-settings-simplify-20260909-001.test.mjs`、`model-follow-session-20260909-005.test.mjs`、`tasks-refine.test.mjs`、`refine-store.test.mjs`、`dispatch-launch.test.mjs` 等断言 Agent 差异化/隐藏逻辑的用例）按新口径更新并通过；新增用例覆盖通用提示词生成与设置区精简后的保存行为。
