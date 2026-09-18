# 测试报告 — BUG-20260906-002 手工先认领时 Zcode 批次仍可认领另一项导致项目并行实施

- 时间：2026-09-06T15:25:22.001Z
- 执行者：zcode-batch-002-1
- 测试框架：node:assert 自定义 runner (npm test)
- 覆盖率：未统计

## 总结

根因（引入源 REQ-20260906-002）：互斥机制只做了批次→手工单向检查，手工 claim 从不占用 impl.lock，批次 next 可再认领另一项致并行实施。修复：core.mjs claim 起占用 impl.lock(kind=manual,itemId)，同 owner 异条目拒绝；report/确认完成/驳回释放；批次/Codex 属主续认幂等不覆盖归属；scheduler 提示加手工认领。新增 Z-A2 回归 2 例，4 个旧测试文件补收尾；43 文件仅 detail-close-btn 既有失败(BUG-20260906-016~018,与本次无关)

## 明细

### 根因分析

- 引入来源：REQ-20260906-002（项目实施互斥机制）
- `scripts/lib/core.mjs` 的 `claim()` 只调用 `assertNoImplConflict` 检查 `.locks/impl.lock` 是否被批次/Codex 占用，但手工认领本身从不获取该锁（只取条目级 `${id}.lock`）。
- 时序：manual-worker claim A（无 impl.lock）→ batch-worker `batch next` 的 `acquireImplLock` 成功 → claim B 被 `assertNoImplConflict` 放行（锁属主是 batch-worker 自己）→ A、B 并行 in-progress（Z-A2 复现）。

### 修复（TDD：先补用例跑红，再实现跑绿）

- `scripts/lib/core.mjs`
  - 新增 `implLockPathOf` / `acquireImplLockForClaim`（kind=manual，同 owner 同条目幂等、同 owner 异条目拒绝「同一时间本项目只能有一个实施任务」、异 owner 由 `assertNoImplConflict` 先拦）/ `releaseImplLockForManual`（仅 kind=manual 且 itemId 匹配时释放）。
  - `claim()`：条目级异 owner 检查前置（保持原「已被认领」提示）；accepted 认领与 in-progress 续认均占用 impl.lock；条目锁获取失败回滚实施占用。
  - `report()`：释放手工实施占用（batch/codex 锁由各自回执收尾释放，不受影响）。
  - `setStatus()`：in-progress→done、done→in-progress（驳回）均释放手工占用（驳回兼作崩溃残留恢复，幂等）。
  - `assertNoImplConflict` 提示映射补「手工认领」。
- `scripts/lib/scheduler.mjs`：project-busy 持锁者提示补 `manual → 手工认领`。

### 测试

- 新增（`scripts/tests/batch-core.test.mjs`，先跑红后跑绿）：
  1. `BUG-20260906-002 手工先认领：批次 next/Codex 派发/他人 claim 均被阻塞；report 后恢复` —— 复现 Z-A2 全链路 + Codex `acquireProjectLock` 失败断言（holder.kind=manual、itemId 指向手工条目）。
  2. `BUG-20260906-002 手工占用：人工确认完成/驳回即释放；批次持锁提示手工归属` —— 人工流转释放 + 批次属主认领后锁归属保持 batch + 批次占用不受手工 report 释放影响。
- 适配（新互斥语义下共享项目用例的跨用例占用残留，均补 report/dropImpl 收尾，断言意图不变）：`actor-name`、`claim-msg`、`pending-alignment`、`lock-lifecycle`。
- 命令与结果：
  - `node scripts/tests/batch-core.test.mjs`：修复前新增 2 例红（"手工认领应占用项目实施互斥"/"驳回应清理手工占用"），修复后全部通过。
  - `npm test`（43 个测试文件）：仅 `detail-close-btn.test.mjs` T2 失败 —— 为 app.js 批量抽屉头部内联 `space-between` 被其全文件断言误伤，属 REQ-20260906-005 在途改动的既有失败（已登记 BUG-20260906-016/017/018），与本次改动无关（本次未触碰 app.js）。

