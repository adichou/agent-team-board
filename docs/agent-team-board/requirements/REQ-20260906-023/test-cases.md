# 测试用例 — REQ-20260906-023 批量实施的批次最多保留 100 个，超出的删除最旧的

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R01 | pruneBatches 单元：构造 5 个已收尾批次，keep=3 时删最旧 2 个、保留最新 3 个（按 createdAt/batchId 序） | 高 | ✅ 通过 |
| R02 | pruneBatches 单元：总数 ≤ keep 时不删任何批次 | 高 | ✅ 通过 |
| R03 | 在途保护：更旧批次含未收尾运行（currentRunId 指向非终态 run）时跳过不删，其余更旧已收尾批次照常删 | 高 | ✅ 通过 |
| R04 | createBatch 集成：真实路径创建第 100/101/102 个批次（每个走完领取→回执收尾）——恰 100 不清理、101 与 102 各删最旧 1 个、目录始终 ≤100 且保留最新端 | 高 | ✅ 通过 |
| R05 | 幂等创建（未结束批次内重复 createBatch）不触发清理；总数未超限时创建不删任何批次 | 中 | ✅ 通过 |
| R06 | createBatch 返回值携带 pruned 清理清单（R04 中 pruned 恰为该次被删的最旧 batchId）；latestBatch 仍指向最新批次 | 中 | ✅ 通过 |

补充说明：

- R01–R03 直接调 `pruneBatches(dataDir, keep)`（keep 可注入，默认 100）；R04–R06 走 `createBatch` 真实路径验证自动触发与默认上限 100。
- 回归：既有 batch-core / batch-cli / dispatch-store / dispatch-api 测试全部通过。
