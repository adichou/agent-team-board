# REQ-20260908-023 批量完善和批量开发生成的提示词要包含对当前会话上下文长度的判断，如果过长要提示用户使用新的会话

- 状态：submitted（待人工接受）
- 创建：2026-09-08T10:25:09.864Z

## 描述

批量完善与批量开发都由「主调度会话」整批驱动：用户把生成的主调度提示词粘贴到 Zcode / codex 会话，主会话逐项派发子代理、只接收短回执并做最小核对。当前提示词只约束了「不复制本会话的历史实施记录、不重复读取全队列/完整报告」（`scripts/lib/batch.mjs` `generatePrompt()`、`scripts/lib/refine-store.mjs` `buildRefinePrompt()`），但随着批次项数增多——尤其是批次排队自动接续（REQ-20260906-025：`stop` 携带 `nextBatch` 时「同一会话不重开」）连跑多批时——主调度会话自身的上下文持续增长，且没有任何指令让主调度判断自身会话是否过长。会话过长后指令遵循质量下降（误派发、漏核对、回执格式漂移），用户也难以察觉。

本需求要求：批量完善与批量开发生成的主调度提示词（zcode / codex × 完善 / 开发共四套）统一加入「当前会话上下文长度自查」指令——每轮派发前判断一次，若过长则不再在同一会话继续派发或接续下一批，改为收尾并明确提示用户在新会话接续。

### 现状与差距（完善阶段整理，基于当前代码）

- 批量完善主调度提示词：`scripts/lib/refine-store.mjs` 的 `buildRefinePrompt()`（约 266 行起，REQ-20260908-020 按 zcode/codex 差异化），现无任何会话长度判断指令。
- 批量开发主调度提示词：`scripts/lib/batch.mjs` 的 `generatePrompt()`（457 行起，模板见 `docs/agent-team-board/batch-execution.md` §6），同样缺失。
- 自动接续放大问题：`generatePrompt()` 488-489 行明确「stop 且核对响应携带 nextBatch 时同一会话不重开，直接替换批次标识继续执行下一批」；长队列下主调度会话可能连跑多批，上下文只增不减。
- 提示词创建时冻结落盘：`createBatch`（batch.mjs 约 560 行）与 `createRefineBatch`（refine-store.mjs 约 417 行）把 prompt 写入批次文件（`docs/agent-team-board/dispatch/batches/<batchId>/batch.json`、`docs/agent-team-board/refine/batches/<batchId>/batch.json`），`batch summary` / `refine summary` 续接时沿用落盘文本——本需求只需改两个生成函数，新建批次即生效。
- 回归锚点：`scripts/tests/batch-core.test.mjs`（约 740-742 行）断言 developer 为空时 `generatePrompt` 输出与既往逐字一致；`scripts/tests/tasks-refine.test.mjs` T8 断言提示词关键内容与双 Agent 差异化。本需求有意变更提示词文本，相关断言需同步按新口径更新。

### 目标细化（完善阶段口径）

1. **四套主调度提示词统一附加「会话长度自查」段**：完善 zcode / 完善 codex（`buildRefinePrompt()`）与开发 zcode / 开发 codex（`generatePrompt()`）口径一致，措辞可按 Agent 的会话约定略异（如 zcode 提「Zcode 本项目新建会话」、codex 提「codex 新会话」）。
2. **自查时机**（提示词指令，两处）：
   - 每轮最小核对返回 `nextAction=continue` 之后、启动下一个子 Agent 之前判断一次；
   - 收到 `stop` + `nextBatch` 自动接续指令（仅开发侧）时判断一次——过长则不在同一会话接续下一批。
3. **过长时的行为**（提示词指令）：
   - 不启动下一个子 Agent，不按 `nextBatch` 在同一会话接续；
   - 在途子代理不受影响：等其回执并完成一次最小核对（保持账本一致）后再收尾，不中途丢弃在途项；
   - 收尾向用户输出明确提示，内容包含：原因（当前会话上下文过长）、批次标识、新会话接续方法——用 `atb refine summary` / `atb batch summary`（可带 `--batch <批次>`）输出的提示词在新建会话发送续跑（批次与运行状态均在文件账本中，新会话不丢账本）；
   - 不代替人工接受需求或确认完成（沿用既有约束）。
4. **「过长」的判断口径（定性自评）**：项目内没有可编程读取会话上下文长度的入口，提示词采用定性描述——会话累计轮次/回执明显增多、接近模型上下文上限、或已出现指令遗漏/响应质量下降时视为过长；不得虚构精确 token 数。是否补充参考阈值（如累计完成项数/轮次）见「待确认」。
5. **范围**：只改两个主调度提示词生成函数及其测试、同步 `docs/agent-team-board/batch-execution.md` §6 模板；不改 CLI 参数、不改批次账本结构、不改看板 UI 与交互。单项 worker 提示词（`buildRefineWorkerPrompt`，codex 逐项执行用）与 worker-spec.md 不在本需求范围——子代理单项生命周期短，不承担整批续跑。

## 界面展示（既有展示位置，本需求不改 UI）

本需求不改任何界面布局与交互，仅改两个生成函数产出的提示词文本；更新后的提示词自动出现在以下既有展示位置。**可交互演示：[./ui-demo.html](./ui-demo.html)**（单文件、无外网依赖，演示提示词在既有位置的出现形态——新增自查段高亮——及主调度会话自查的状态流转；演示中的按钮文案与阈值为交互模拟，具体措辞以开发阶段实现为准）。

### 界面布局（均无变化，仅 `<pre>` 内文本新增一段）

- **CLI 输出**（`scripts/atb.mjs`）：`atb refine create` / `atb batch create` 在「✓ 已创建批次 → 候选计数行 → 完整清单存文件行 → 提示词说明行」之后，以 `-----` 分隔线包裹输出完整主调度提示词（逐行缩进）；`atb refine summary` / `atb batch summary` 的续接提示词为同一结构（沿用批次落盘文本）。新增的「会话上下文长度自查」段出现在提示词中部（`stop + nextBatch` 自动接续说明之后、收尾约束之前，具体位置开发阶段定）。
- **看板任务模块**（`scripts/web/app.js` `renderZcodeBatchPanel()` / 完善任务面板）：
  - 启动区（无批次时）：候选统计行（「已计划候选 N · 受依赖阻塞 M」）+ 开发人员输入框 + 「创建批次并复制提示词」主按钮；无候选时为空态提示条（布局不变）。
  - 运行区（批次创建后）：状态行（状态 chip + 批次 ID + 执行 Agent）→ 元信息网格（当前条目 / 子代理会话 / 计数等）→ 主调度提示词块（`.batch-prompt-block`）：工具行（「主调度提示词（新建 zcode/codex 会话粘贴发送）：」+ 开发侧「重新复制 / 复制续接提示词 / 打开 Zcode 工作区」、完善侧「重新复制」）+ `<pre class="batch-prompt">` 全文展示（虚线边框、等宽 12px、`pre-wrap`、`max-height` 滚动、`user-select: all` 一键全选，`scripts/web/style.css` 1128-1146）。

### 交互行为（均无变化）

- 看板「创建批次并复制提示词」/「重新复制」复制到剪贴板的即同一生成函数输出，文本随本需求自动更新（复制失败可点击提示词框一键全选手动复制）；CLI 则由用户手动选择 `-----` 之间的提示词文本复制。
- 用户把提示词粘贴到 Zcode 本项目新建会话（或 codex 会话）发送，主调度逐项派发子代理——本需求新增的交互约定全部发生在**会话内**（见下），不改任何界面元素。

### 状态反馈（由提示词驱动，非界面元素）

- **正常**：每轮最小核对返回 `nextAction=continue` 后，主调度先自查会话长度，未过长则继续派发下一项（会话内无额外输出，短回执照常）。
- **过长**：自查判定过长时——不启动下一个子 Agent；`stop + nextBatch` 到来时不在同一会话接续下一批（REQ-20260906-025 的自动接续让位）；在途子代理等其回执并完成一次最小核对后再收尾；随后在会话末尾输出一段文字提示，内容包含：原因（当前会话上下文过长，定性自评）、批次标识、新会话接续方法（用 `atb refine summary` / `atb batch summary`（可带 `--batch <批次>`）输出的提示词在新建会话发送续跑，批次与运行状态在文件账本中不丢失），本会话调度结束。
- **续接**：用户在新会话发送 summary 提示词，主调度从文件账本恢复批次状态继续派发剩余项，上下文从新会话起重新累计。
- 看板侧各状态（执行中 / 暂停 / 终止 / 排队接续等）的界面反馈均维持现状，本需求不新增任何看板状态或提示条。

## 验收标准

- [ ] `buildRefinePrompt()`（`scripts/lib/refine-store.mjs`）zcode 与 codex 两套完善主调度提示词均包含「当前会话上下文长度自查 + 过长时提示改用新会话接续」的指令。
- [ ] `generatePrompt()`（`scripts/lib/batch.mjs`）zcode 与 codex 两套开发主调度提示词同样包含上述指令；`docs/agent-team-board/batch-execution.md` §6 模板同步更新。
- [ ] 自查时机覆盖两处：`nextAction=continue` 后启动下一个子 Agent 前、`stop` + `nextBatch` 自动接续前；过长时同一会话不接续下一批（REQ-20260906-025 的自动接续让位于本规则）。
- [ ] 过长时的提示内容完整：说明原因、批次标识、新会话接续入口（`atb refine summary` / `atb batch summary` 的提示词）；在途子代理先回执并核对再收尾；不得编造不存在的 CLI 参数或路径。
- [ ] 判断口径为定性描述且不虚构 token 数；四套提示词的该段口径一致。
- [ ] 新建的完善/开发批次落盘 prompt（batch.json）含新指令；存量批次落盘提示词不回填，`summary` 续接沿用落盘文本（创建时冻结口径不变）。
- [ ] 测试同步：`scripts/tests/batch-core.test.mjs` 中「developer 为空时逐字一致」的回归断言按新口径更新；`scripts/tests/tasks-refine.test.mjs` T8 双 Agent 差异化断言继续通过；新增断言覆盖四套提示词均含自查段。
- [ ] 回归：`atb refine` / `atb batch` CLI 参数、批次账本结构、看板 UI 布局与交互均无变化；单项 worker 提示词（`buildRefineWorkerPrompt`）与 worker-spec.md 不变。

## 待确认

- 「过长」是否给出参考阈值（如主会话累计完成 N 项 / M 轮核对后建议换会话）：默认不给硬阈值、仅定性描述（主调度无法精确感知上下文占用），待确认。
- 提示词为创建时冻结落盘：本需求默认只影响新建批次、存量批次不回填；是否需要在 `summary` 续接时对存量批次重新生成含新指令的提示词，待确认。
