# 测试报告 — BUG-20260906-001 全依赖阻塞批次已结束但 check 仍返回 continue

- 时间：2026-09-06T15:10:23.493Z
- 执行者：zcode-batch-002-1
- 测试框架：node:test 风格自研聚合（node:assert/strict，scripts/tests/run-all.mjs）
- 覆盖率：未统计

## 总结

修复全受阻批次 check 误返 continue：scripts/lib/batch.mjs 新增 remainingDisposition（与 nextItem 逐候选出局判定同口径：终态运行跳过、目录损坏/冻结后被认领或流转出局、依赖未满足受阻），checkBatch 在 remaining>0 且无可派发候选时改判 stop 并附带 counts.blockedPending 准确受阻计数、notice 说明原因、批次落 finished；nextItem 的 stop=blocked 响应同样附 blockedPending；atb batch check 人类可读输出增加「受阻待处理」。依赖后续满足时 check 恢复 continue、批次可复活继续派发。回归用例 TC-1/TC-2 先红后绿（batch-core.test.mjs）；Z-A1 验收探针复刻 + 真实 CLI 复核通过（dispatch/runs/run-20260906-006/）。全量 npm test 43 文件仅 detail-close-btn.test.mjs T2 存量失败（与本修复无关，已登记 BUG-20260906-018）。

## 明细

### 根因分析（引入来源见 README「关联」节：REQ-20260906-002）

- `nextItem`（scripts/lib/batch.mjs）逐候选判定出局：已有终态运行 / 目录损坏 / 冻结后被认领或流转 / 依赖未满足（`depBlocked`）；无可派发候选时返回 `stop=blocked` 并把批次置 `finished`。
- `checkBatch` 的 `nextAction` 却只看「终态运行计数」：仅 `counts.remaining === 0` 才判 stop。全部剩余项依赖受阻时 remaining=1、blocked=0（blocked 只统计 `phase==='blocked'` 的终态运行），于是返回 continue。
- 主调度按「nextAction=continue → 派新子 Agent」运转：worker 调 next 又得 stop=blocked，无限派空 worker，批次收不了尾。冻结后条目被外部认领（非依赖受阻）的同理。

### 修复（TDD：先红后绿）

1. `scripts/lib/batch.mjs` 新增 `remainingDisposition(dataDir, batch, state, policies)`：按 nextItem 同口径盘点剩余候选的 `dispatchable / blockedIds / outIds`，注释声明两处共用防口径漂移。
2. `checkBatch` 在 `remaining>0` 时盘点：无可派发候选 → `nextAction='stop'`，notice 注明「依赖受阻 N 项 / 冻结后已被认领或流转 N 项，不派空 worker」，批次落 `finished`（与 nextItem 收尾一致，保证 createBatch 幂等不吞新批次）；`counts.blockedPending`（>0 时附带）给出准确受阻计数。依赖满足后动态解除：check 恢复 continue，next 可继续预留（批次复活）。
3. `nextItem` 的 `stop=blocked` 响应同样附带 `counts.blockedPending`。
4. `scripts/atb.mjs` 的 `batch check` 人类可读计数行增加「受阻待处理 N」（JSON 载荷为增量字段，向后兼容）。
5. 回归用例：`scripts/tests/batch-core.test.mjs` 新增「BUG-20260906-001 全部依赖受阻…」与「BUG-20260906-001b 剩余项冻结后被外部认领…」两条（先跑红复现症状 `nextAction:"continue", blocked:0, remaining:1`，修复后转绿）。

### 证据

- 单文件：`node scripts/tests/batch-core.test.mjs` → 全部通过（含 2 条新用例）。
- 验收探针复刻（不改原始证据文件）：`docs/agent-team-board/dispatch/runs/run-20260906-006/verify-z-a1.mjs`
  及输出 `verify-z-a1-output.json` —— Z-A1 场景 first/after check 均 `nextAction=stop` 且 `blockedPending=1`；真实 CLI `atb batch check` 输出 `nextAction: stop · 受阻待处理 1 · 本批剩余 1 项暂不可实施（依赖受阻 1 项），不派空 worker`。
- 全量回归：`npm test`（43 个测试文件）仅 `detail-close-btn.test.mjs` T2 失败——其断言对整个 scripts/web/app.js 做 `doesNotMatch /justify-content:space-between/`，被 `renderBatchDrawer()`（约 1273 行）合法的内联 space-between 误伤；该文件最后修改 2026-09-06 22:38，早于本次会话且本次未改动，属存量问题，已按规范登记 BUG-20260906-018（submitted 待人工接受）。
- check 响应体积：TC-1 断言 ≤ CHECK_MAX_BYTES（2 KiB）通过。

