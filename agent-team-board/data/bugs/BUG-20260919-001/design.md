# 设计 — BUG-20260919-001 已终止批次被在途回执复活为 running，队首永久 stop=aborted 阻塞后续批次派发

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-020（重构批量流程和任务管理，`atb list` 核验存在）。该单引入批次人工终止机制
  （`abortRequested` / `abortBatch` 将在途运行落 interrupted、批次置 finished 终态），但两处配套缺失：
  1) `finishRun` 收尾重算批次状态（重算逻辑源自 REQ-20260906-002 的回执协议）未 guard `abortRequested`，
     且 interrupted 不在 FINAL_RUN_PHASES、补交回执不被拒绝，构成复活入口；
  2) `abortBatch` 幂等分支只返回不修复账本。BUG-20260908-023 已修「暂停/恢复复活终态批次」
  （pauseBatch/resumeAfterConfirm 侧 batchTerminalReason 守卫），但未覆盖 finishRun 在途回执路径与本单次生问题。

## 根因分析

- 复活入口：`abortBatch` 把在途 run 置 `interrupted`，但 `interrupted` 不在 `FINAL_RUN_PHASES`（reported|blocked|failed），
  未被停止的在途子代理事后 `report + run receipt` 时 `finishRun` 不拒绝、照常落账并走到收尾重算分支：
  `batch.status = pauseRequested ? 'paused' : (remaining > 0 ? 'running' : 'finished')`，未判 `abortRequested`。
  实时候选口径（effectiveCandidates 含账面外 planned 未认领条目）下 `remaining > 0` 几乎恒真，
  已终止批次（abortRequested=true）被改写回 `status='running'`。
- 队首卡死：`unfinishedBatches` 以 `status !== 'finished'` 判定未结束，复活的 048 重新成为队首；
  `nextItem`/`checkBatch` 先判 `abortRequested` → 永远返回 stop=aborted，既不结束也不让位后续批次
  （`nextItem` 的前序未结束检查使 049 永久排队）。
- 无法自愈：重复 `atb batch abort` 命中幂等分支（abortRequested 已 true）直接返回，不重算 status、
  不补剩余项 skip，人工无法用同一入口修复已复活的账本。
- 同源风险面：`finishRun` 的挂起分支（paused）、失败分支（needs_attention + holdImplAttention）同样未判
  abortRequested，补交 blocked/failed 回执也可改写终态批次——修复须整段 guard，而非只护 reported 一支。

## 方案

纯状态机修复（scripts/lib/batch.mjs），两处改动，无界面改动、不引入开源库（自研理由：仅修本仓状态机
分支判断，无可复用的外部库）：

1. `finishRun` 收尾 guard：run/receipt/autoCommit/证据核对照常落账后，若 `batch.abortRequested` 为 true，
   批次保持终止终态——`status` 置 'finished'（顺带把已复活的存量账本就地修复回终态）、清 `currentRunId`、
   不写 pauseRequested、不进入挂起/失败分支（不 declareCommitConfirm、不 holdConfirmAttention /
   holdImplAttention）、不释放项目实施锁（终止时已全量释放，锁可能已归后续批次），直接返回回执。
2. `abortBatch` 幂等自愈：abortRequested 已 true 时不再只返回——在途运行补 interrupted、未出局候选补
   skipped 出局账、`currentRunId` 清空、`status` 非 finished 时重算置 finished；同样不触碰项目实施锁
   （避免把已归后续批次的锁误释放）。修复后重复终止具备账本自愈能力。
3. 队列接续自动恢复：已终止批次保持 finished 后不再进 `unfinishedBatches`/队首，`batch next`/`batch check`
   缺省解析落到下一个未结束批次，无需额外改动；正常路径（未终止批次 reported/safe 按 remaining 置
   running/finished、failed→needs_attention、挂起→paused）行为不变。

**开源选型（REQ-20260909-015）**：无引入（本单为纯状态机逻辑修复，未引入任何第三方库，不创建 licenses.md）。

## 风险与边界

- 存量账本：登记时 048 已人工收尾（2026-09-19 复核呈 finished + aborted=true、049 已恢复 running），
  本单不改动任何真实账本；代码修复保证此后在途回执无法复活已终止批次，幂等自愈可兜底修复同类历史账本。
- 幂等自愈不释放实施锁是刻意取舍：复活只改写了 status，锁在原终止时已全量释放，其后锁可能已归后续
  批次/手工认领，重放全量释放会误伤现任持锁者。
- 同源排查：批量完善 refine-store.mjs 的 `FINAL_REFINE_PHASES` 含 interrupted，在途回执入口即被拒，
  不存在本缺陷的复活入口（幂等分支同样只返回，但无路径可产生复活账本，无需改动）。
- 已终止批次补交回执若自动提交不完整，不再走「待人工确认提交」挂起（挂起会再次阻塞后续批次派发）；
  遗留工作区改动按既有预留前脏改动口径（BUG-20260913-006 pendingManual）由后续运行归因，不静默丢失。
