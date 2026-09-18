# 设计 — BUG-20260908-014 批量完善终止后面板缺少重新启动入口

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260908-020（已核验存在：`atb list` 显示该需求「重构批量流程和任务管理」，in-progress）。
  归因：REQ-20260908-020 实现批量完善任务模块时，`renderRefinePanel` 运行态的「启动新任务」按钮条件写成
  `batchDone && !b.aborted`，与终止收尾路径（`abortRefineBatch` 置 `finished + aborted`、`remaining=0`）组合后
  终止态两个启动入口同时消失——属该需求实现遗漏「终止后交互闭环」（终止确认弹窗文案已承诺「终止后可立即启动新任务」）。

## 根因分析

- `abortRefineBatch`（`scripts/lib/refine-store.mjs`）终止后：批次 `status='finished'`、`aborted=true`、剩余项落
  skipped 出局账（`remaining=0`），批次仍是最新批次；
- `/api/refine/current` 经 `queueHeadRefineBatch` 解析：无未结束批次时回退返回最新批次，因此终止后接口仍返回
  该 aborted batch 作为 `batch`（`data.batch` 非空）；
- `renderRefinePanel`（`scripts/web/app.js`）中两个启动入口的渲染条件同时被否：
  - 启动区（`refineCreate`）仅在 `!data.batch` 时渲染 → 被非空 `batch` 否掉；
  - 「启动新任务」（`refineNext`）仅在 `batchDone && !b.aborted` 时渲染（`batchDone = status==='finished' &&
    remaining===0`，终止后恒真）→ 被 `!b.aborted` 否掉。
  两个入口互斥且终止态都不满足，重启动口缺失。

## 方案

选定方案 1（README 期望口径二选一中的第 1 种）：终止批次收尾后，在批次面板内显示「启动新任务」按钮。

- `renderRefinePanel` 中 `refineNext` 的渲染条件从 `batchDone && !b.aborted` 放宽为 `batchDone`
  （批次已收尾：`finished` 且 `remaining=0`，含终止态）；
- 「本批完善范围已处理完毕」的 ok notice 维持仅非终止态显示（终止态已有「任务已人工终止」warn notice，不误报完成）；
- 按验收第 3 条：无候选时（`data.candidates` 为空，实时口径）`refineNext` 渲染为禁用并以 title 说明
  「暂无可完善候选：已接受条目均已完善（或尚无已接受条目）」，避免点击后接口报错；
- 点击行为复用现有 `createRefineBatchAndCopy`（以当前已接受未完善候选创建新任务并复制主调度提示词，幂等口径不变）。

不选方案 2（`/api/refine/current` 对已终止收尾批次不再返回 `batch`、面板回退启动区）的原因：

- `queueHeadRefineBatch` 的「回退最新批次」语义同时服务于 `/api/refine/records`、`/api/refine/abort`、
  `/api/refine/pause` 及 CLI 的缺省批次解析，改口径需区分「终止收尾 / 正常收尾」，波及面大；
- 方案 2 会终止后立即丢掉被终止批次面板，与验收「被终止批次的执行记录/出局账仍可查看」冲突；
- 方案 1 仅改前端渲染条件，改动最小且 D06 夹具（断言终止态 HTML 含 `refineNext` 或 `refineCreate`）即按此设计。

## 风险与边界

- 终止态下「暂停/恢复」按钮仍渲染、后端 `pauseRefineBatch` 会把终止批次 `status` 改回 `paused`（复活）——
  这是已登记的独立 Bug BUG-20260908-015（D12 口径），本修复不动后端，不在此收敛；
- 终止后迟到的 `refine done` 被拒（D07）与暂停/恢复链路（D08）不受影响：本修复只改 `renderRefinePanel` 的
  按钮渲染条件与禁用态，不改 store/接口；
- 批量开发面板（`renderZcodeBatchPanel`）同类交互不改（其「创建下一批」条件不含 aborted 否定，无此问题）；
- 回归范围：`refine-ui.test.mjs`（补 R12-8 用例）+ 深测夹具 deep-probes.mjs（D06 转绿、D07–D11 不回归）+
  全量 `npm test`。
