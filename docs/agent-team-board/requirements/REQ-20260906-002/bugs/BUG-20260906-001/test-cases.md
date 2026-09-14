# 测试用例 — BUG-20260906-001 全依赖阻塞批次已结束但 check 仍返回 continue

回归用例落在 `scripts/tests/batch-core.test.mjs`（与 REQ-20260906-002 批次核心测试同文件）。

## TC-1 全部依赖受阻：check 应 stop 并带准确受阻计数（对应验收探针 Z-A1）

1. 隔离项目建 A、B（均 accepted）；A 依赖未 done 的 B；`limit=1` 建批（候选只含 A）。
2. 首次 `checkBatch`：nextAction 必须为 `stop`（无任何可派发候选，主调度不应派 worker），
   `counts.blockedPending` = 1，notice 说明受阻。
3. `nextItem`：返回 `stop=blocked`，`counts.blockedPending` = 1。
4. 再次 `checkBatch`：nextAction 必须为 `stop`（回归点：修复前为 continue），
   `blockedPending` = 1，批次 status 落为 finished。
5. B 人工流转为 done 后：check 恢复 `continue`，next 可正常预留 A（依赖动态解除，批次可复活）。

## TC-2 剩余项被外部认领（冻结后流转，非依赖受阻）

1. A 入批后模拟他人直接认领（forceClaim）。
2. `checkBatch`：nextAction 必须为 `stop`（与 next 的 stop=blocked 口径一致，不派空 worker）；
   remaining=1 且不产生 blockedPending（非依赖受阻）。

## 判定

- 上述用例全部通过 `node scripts/tests/batch-core.test.mjs`；
- 全量 `npm test` 不出现新的失败；
- `check` 响应保持 ≤2 KiB（沿用 CHECK_MAX_BYTES 断言口径）。
