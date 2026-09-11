# 测试用例 — REQ-20260907-013 支持当前已有批次执行中时，可以创建新批次。没在执行中的新批次可以被删除。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | core：批次有在途运行（nextItem 预留未收尾）时 createBatch 成功，新批排队尾（执行中创建回归） | P1 | 通过 |
| D1 | core：删除排队中（未执行）批次——账本目录移除、unfinishedBatches 缩短、后续位次前移 | P1 | 通过 |
| D2 | core：删除有在途运行的批次被拒绝，错误含在途 runId；收尾后可删且 runs 记录保留 | P1 | 通过 |
| D3 | core：删除 needs_attention 批次被拒绝（提示先人工核对恢复） | P1 | 通过 |
| D4 | core：删除已结束（finished）批次成功；删除不存在批次报「找不到批次」 | P1 | 通过 |
| D5 | core：删除队首未执行批次后，下一批次成为队首且 nextItem 可直接领取（防抢解除） | P1 | 通过 |
| D6 | serve：POST /api/batch/delete 删除排队批次成功；在途批次 / 不存在批次返回 400 | P1 | 通过 |
| D7 | cli：atb batch delete <ID> 成功退出 0 且提示；在途批次与缺参报错；needs_attention 拒绝 | P1 | 通过 |
| D8 | ui：静态契约——执行中面板「排队新批次」按钮复用创建流程；排队列表项与当前批次删除入口、uiConfirm 确认、/api/batch/delete 调用 | P1 | 通过 |

实施说明：测试文件 `scripts/tests/batch-delete.test.mjs`（9 用例全通过）；`npm test` 全量 74 个测试文件回归 0 失败。修复过程发现并改正一处实现笔误（`batchesDir(dataDir, batchId)` 多传参导致误删整个 batches 根目录），由 D1/D5/D6/D7 用例捕获。
