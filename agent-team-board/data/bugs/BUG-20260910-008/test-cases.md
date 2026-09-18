# 测试用例 — BUG-20260910-008 批量完善提示词中要针对自动转入计划的配置进行处理

自动化测试：`scripts/tests/refine-prompt-autoplan-20260910-008.test.mjs`（node 直接运行）。
约束基线：开关关闭（默认）时提示词/回显与现状逐字一致（零回归）；打开时提示词承认系统流转并明示「不得据此暂停」，Agent 自身纪律不放宽；`refine done` / `autoPlanRefinedItem` 行为与输出语义零改动（由既有 `refine-auto-plan-20260909-010.test.mjs` 回归覆盖）。

## A 主调度提示词生成两态（buildRefinePrompt）

- [ ] A1 关闭（默认 / 显式 false）：约束首行仍为「硬性约束：条目全程保持 accepted（已接受）；不要修改业务源码；不要修改条目 status.json；」，全文不含「自动转入计划」字样；与不传开关的既有输出一致（零回归）。
- [ ] A2 打开：约束段说明「完善完成后自动转入计划」已开启——done 回执核验通过后系统（非 Agent）自动 accepted → planned（回显「已自动转入计划」）；看到该输出或条目变为 planned 属预期系统行为、不得据此暂停/中止/等待人工确认、照常 refine check 并继续派发下一个子代理；同时保留 Agent 纪律（不改业务源码 / 不改 status.json / 不执行 atb status）与既有第二行（claim/report / test-report.md / git commit / 只编辑 markdown）。
- [ ] A3 生成链路联动（createRefineBatch）：设置关闭时冻结 OFF 提示词；开启后新建批次冻结 ON 提示词。

## B codex 单项提示词两态（buildRefineWorkerPrompt / newCodexRefineRun）

- [ ] B1 关闭（默认）：第 3 条约束与现状逐字一致（「3. 条目保持 accepted（已接受）：不要修改业务源码、不要改 status.json、不要 claim/report、」+ 既有续行），零回归。
- [ ] B2 打开：第 3 条分态为 ON 文案——补全要点核验记账后系统自动 accepted → planned 属预期系统行为，不得据此暂停；你自身仍不得改状态（不改 status.json / 不执行 atb status / 不 claim/report）；既有续行（test-report.md / git commit / 只编辑 markdown）保留。
- [ ] B3 newCodexRefineRun 联动：设置开关决定 run.prompt（与 prompt.md 落盘一致）分态。

## C 展示层归一（normalizePromptForDisplay）

- [ ] C1 开关打开（autoPlan: true）：存量 OFF 约束行（主调度/worker 两形态）整段替换为对应 ON 文案，其余行逐字不动；对现行 buildRefinePrompt(autoPlan: true) 输出幂等（二次归一不变）。
- [ ] C2 无选项（存量调用形态）：OFF 输出原样返回（既有用例零回归）；开发侧 generatePrompt 输出传 autoPlan: true 也不被改写（归一只作用于完善约束行形态）。
- [ ] C3 开关关闭（autoPlan: false）：冻结的 ON 文案归一回 OFF 约束行（实时口径两方向归一，见 design.md 结论），幂等。
- [ ] C4 非字符串透传（null/undefined/空串）不受选项影响。

## D 透出链路（CLI / 数据层，账本不回写）

- [ ] D1 CLI refine create：默认关闭——JSON prompt 与文本输出行与现状一致（含「条目保持 accepted（已接受），不占实施互斥」）；开启——prompt 含自动转入计划说明，输出行附「完善后自动转入计划已开启」与预期系统行为提示。
- [ ] D2 存量未结束批次：冻结 OFF 提示词后打开开关，refine create 幂等返回的回显 prompt 归一为 ON 文案，账本 batch.json 冻结原文不被改写。
- [ ] D3 数据层实时分态：refineSummary / refineBatchPublicView 按当前开关归一（开 → ON 文案；关回 → OFF 行），账本原文不变。
- [ ] D4 usage 文案：REFINE_USAGE 说明「完善完成后自动转入计划」开启时 done 后系统自动 accepted → planned 属预期系统行为、Agent 仍不得改状态（静态两态说明）。

## E 行为零回归（护栏）

- [ ] E1 refine done / autoPlanRefinedItem / state-guard / HUMAN_ONLY_TO 行为与输出语义零改动（源码契约断言 + 既有套件回归）。
