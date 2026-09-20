# 测试用例 — REQ-20260909-011 优化批量完善和批量开发的提示词，不再区分 Agent，使用通用的描述词。设置中去掉 Agent 的配置

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

新增契约测试文件：`scripts/tests/agent-generic-20260909-011.test.mjs`（下表 A–G，19 个用例）；
既有测试按新口径更新（下表 H，断言 Agent 差异化/隐藏逻辑的用例随实现同步改写，共 14 个文件）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 通用完善提示词：buildRefinePrompt 单一版本——不传 agent 与传 zcode/codex 输出完全一致；不含 zcode/Zcode/codex/Codex/general-purpose 字样 | P0 | 通过 |
| A2 | 通用完善提示词调度要素保留：项目路径、批次标识、开发人员会话命名、CLI 约定（atb=node…）、领取 `refine next --by refine-<批次尾号>-<序号>`、done/fail 回执、硬性约束、`refine check` 与 nextAction 处置 | P0 | 通过 |
| A3 | 通用开发提示词：generatePrompt 单一版本（agent 参数忽略）；不含执行端字样与 general-purpose；保留执行规范路径、批次摘要入口、nextAction、nextBatch 排队接续说明 | P0 | 通过 |
| A4 | FOLLOW_SESSION_PROMPT_LINE 措辞通用化：不出现 codex / exec / --model / model_reasoning_effort / 设置「批量任务」静态值指向；仍含「跟随主调度会话」「与当前主调度会话保持一致」 | P0 | 通过 |
| B1 | createRefineBatch 新账本：mode/agent 记 `subagent`；prompt 为通用版（含跟随模型指令、通用前缀）；直连显式 mode:'codex' 仍合法（兼容存量语义） | P0 | 通过 |
| B2 | refine 幂等去 Agent 化：存在未结束通用批次时再次创建（显式 mode:'codex'）幂等返回同一批次，不并行新建 | P1 | 通过 |
| B3 | createBatch 新账本：agent 记 `subagent`（mode 维持 zcode）；prompt 为通用版；直连 agent:'codex' 仍合法 | P0 | 通过 |
| C1 | CLI：atb refine create 默认与 --mode codex 均生成通用提示词（含跟随行、refine- 前缀、无执行端字样）；输出行不再出现「执行 Agent」 | P0 | 通过 |
| C2 | CLI：atb batch create 生成通用提示词（含跟随行、无执行端字样、含 nextBatch 接续）；复制指引文案不含 Zcode 字样 | P0 | 通过 |
| D1 | 服务端 /api/batch/create：不带 agent 可创建，返回 agent=subagent、通用提示词；带 agent 参数不报错（忽略） | P0 | 通过 |
| D2 | 服务端 /api/refine/create：不带 mode / 带 mode 均可创建，返回通用提示词（无执行端字样、refine- 前缀、跟随行） | P0 | 通过 |
| D3 | 服务端 /api/tasks/settings POST：agents/models 键被忽略（agents 不被修改），仅 refine.autoPlanAfterDone 生效；GET 结构原样 | P0 | 通过 |
| E1 | 设置区精简：taskSettingsHtml 仅含标题、通用说明（子代理模式/提示词通用/跟随主调度会话）、「完善完成后自动转入计划」开关与保存按钮；无表格/隐藏复选框/来源下拉（tsSource/tsModel/tsLevel/tsHidden 均不存在） | P0 | 通过 |
| E2 | 设置保存载荷：仅提交 `{ refine: { autoPlanAfterDone } }`（不含 agents/models）；草稿反馈与防重复提交机制保留 | P0 | 通过 |
| E3 | 开发启动区与终态：无「执行 Agent」下拉（#devMode/#devNextMode 不存在）、无全部隐藏禁用提示、无生效模型口径行；有候选可启动；无候选禁用并说明原因；启动请求体不带 agent | P0 | 通过 |
| E4 | 完善启动区与终态：#refineMode/#refineNextMode 不存在；有候选可启动；无候选禁用并说明原因；创建请求体不带 mode | P0 | 通过 |
| E5 | 运行概况行：新批次（agent=subagent）仅展示「子代理模式」；存量批次（agent=zcode/codex）保持「执行 Agent xxx（子代理模式）」不回溯 | P1 | 通过 |
| F1 | 存量数据层兼容：loadTaskSettings 读存量 agents/models（含手动值/全隐藏）不报错；saveTaskSettings 局部合并不变（T10/T3/D6 既有断言不回归） | P0 | 通过 |
| G1 | 直连兼容回归：generatePrompt/buildRefinePrompt 不传模型信息不注入行；manual 固定行、developer 会话命名等直连行为不变 | P1 | 通过 |
| H1 | 既有测试按新口径更新并通过：tasks-refine（T8/T9/T12）、model-follow-session-005（4/7/8/9–14）、task-settings-simplify-001（T1/T2/T7/T8/T9）、refine-ui（R12-3/R12-7/R12-10）、tasks-panel-26（K1/K10/K11）、tasks-tabs-008（N7/N12/N13）、planned-state（S12）、batch-title-removed、refine-serve、batch-ui、impl-entry-ui、settings-simplify-002、settings-runparams-removed-011、refine-auto-plan-010 | P0 | 通过 |
