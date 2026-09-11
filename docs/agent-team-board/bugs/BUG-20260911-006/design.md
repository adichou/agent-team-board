# 设计 — BUG-20260911-006 全局任务中需要加上批量 Commit 的任务状态

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260910-003**（全局任务看板；编号已经 `atb list` 核验真实存在，状态 in-progress）。
  该需求落地 `projectTaskRows()` 聚合时把口径硬编码为「批量开发 + 批量完善」两类账本
  （`unfinishedBatches` + `unfinishedRefineBatches`），前端 `GLOBAL_KIND_FILTERS` /
  `GLOBAL_KIND_LABEL` / `gotoProjectTask` 同步只枚举 develop / refine 两档。后续
  BUG-20260910-014（批量 Commit UI，`atb list` 核验 in-progress）新增第三类任务账本
  `commits/batches/`（CLI 能力来自 REQ-20260910-013）时，聚合层未同步扩展，且其完善时已把
  「全局任务聚合是否同时加入 Commit」登记为待确认遗留项——本单即该遗留项的兑现。

## 根因分析

- 服务端 `scripts/server.mjs` `projectTaskRows()`：单项目聚合只读 dispatch / refine 两类未结束批次，
  未调用 `commit-store.mjs` 已提供的同构 `unfinishedCommitBatches()`；`aggregateGlobalTasks()` 的
  `corruptBatchIds` 损坏账本扫描也只覆盖 dispatch / refine 目录，`commits/batches/` 不在内。
- 前端 `scripts/web/app.js`：`GLOBAL_KIND_FILTERS` / `GLOBAL_KIND_LABEL` 无 commit 档（筛选与徽标缺失）；
  `gotoProjectTask()` 的 kind→mode 映射只有 `refine / develop` 两分支（跳转无法激活「批量 Commit」页签）；
  `globalCountsParts()` 无 commit 分支（计数口径缺失）。
- 本质：三类任务账本同构（batch / refine / commit），但全局聚合层按类型枚举、新类型接入需三处显式
  登记（服务端聚合、损坏扫描、前端映射），漏登记即出现跨项目总览盲区——与 BUG-20260911-005
  （laneQuickEntry 漏登记 done 档）同模式的登记遗漏。

## 方案

与 develop / refine 完全同构的「第四类账本接入」，全部只读：

1. `scripts/lib/commit-store.mjs` 新增导出 `commitBatchBrief(dataDir, batchOrId)`：
   结构对齐 `batchBrief` / `refineBatchBrief`——`kind: 'commit'`、batchId、mode、status、
   pauseRequested、abortRequested、aborted、createdAt / lastActivityAt、current（itemId / title /
   owner / createdAt，用既有 `titleOfRun` 补标题）、counts（`commitBatchState` 原始计数：
   committed / failed / skipped / interrupted / remaining / total）。纯只读：内部只用
   `commitBatchState`（读 run.json 汇总），**不调用** `checkCommitBatch`（其会实时吸收新候选、
   可能改写 finished）、不写账本、不碰锁。
2. `scripts/server.mjs` `projectTaskRows()` 增加 commit 段：`unfinishedCommitBatches(dataDir)`
   过滤 `aborted` 后逐批 `commitBatchBrief`，非队首 prepared 补 `queued`（排队中口径与另两类一致，
   逐批成行——README 待确认 2 的落地）；`aggregateGlobalTasks()` 的损坏扫描数组追加
   `commits/batches` 目录（README 待确认 4 随聚合一并修）。
3. `scripts/web/app.js`：`GLOBAL_KIND_FILTERS` / `GLOBAL_KIND_LABEL` 增加 `commit: '批量 Commit'`；
   `globalCountsParts()` 增加 commit 分支——已提交 = committed，异常 = failed + interrupted
   （skipped 出局不计，与任务模块面板 `taskStatsLine` 口径一致，README 待确认 3：不展示提交号明细）；
   `gotoProjectTask()` 映射扩为 `refine / commit / develop` 三分支（跳转 → `gotoRuns('commit')`
   激活「批量 Commit」页签，仅导航）；全部收尾空态文案补「批量 Commit」。
   搜索（批次号 / 当前条目编号与标题 / 子代理会话）与汇总计数复用既有逻辑，commit 行天然生效。

**待确认项的落地口径（README「待确认」）**：

- 「待核对」档：**仅按账本 status 展示**。develop / refine 的 needs_attention 是账本持久状态
  （人工介入挂起）；commit 的 `nextAction=needs_attention` 是「当前执行未收尾」的派生态，子代理
  正常执行期间恒为真，纳入汇总会把所有执行中 commit 行误计为「待核对」且与状态 chip「执行中」
  自相矛盾，故不派生。commit 账本状态仅 prepared / running / paused，正常参与各档计数。
- 多个未收尾批次：逐批成行（非队首 prepared 显示「排队中」），与 develop / refine 一致。
- 提交号明细：不展示（与另两类不展示回执明细一致）。
- `corruptBatchIds` 覆盖 commit 目录：纳入本单（随聚合一并修）。

**开源选型（REQ-20260909-015）**：自研理由——无合适库：改动是既有零依赖服务端聚合函数加一段
同构批次遍历、既有单文件前端三处映射常量 / 分支的扩展；引入任何聚合 / UI 库的成本远高于自研，
且项目 web 端为零依赖原生 JS 架构。未引入开源库，不创建 licenses.md。

## 风险与边界

- 只读红线：聚合不调用 `checkCommitBatch`、不触发锁 / 核对 / 结算、不产生任何 Git 操作——
  新增测试 C3 校验 GET 前后 `batch.json` 字节不变、无候选吸收、runs 目录不增。
- 既有展示回归：develop / refine 的展示 / 筛选 / 跳转不动；由 global-board-20260910-003（G1–G7）
  与 global-search-ui / global-entry-panel / global-panel-head-compact 等既有测试守护。
- 损坏扫描扩展可能让此前静默的 commit 坏账本显性化为错误行——这是期望行为（与 dispatch / refine
  同口径），不影响其他项目行。
- 状态词表：commit 无 needs_attention 账本状态，`batchStatusLabel` 既有 prepared / running / paused
  标签直接复用；aborted 批次已在服务端过滤（abortCommitBatch 落 status=finished + aborted，双重不出现）。
