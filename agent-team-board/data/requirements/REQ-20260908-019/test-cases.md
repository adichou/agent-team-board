# 测试用例 — REQ-20260908-019 批量执行去掉上限的设置

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| Z02a-r | 无上限创建：3 候选全量冻结入批；新批次记录无 `limit` 字段；候选不变时重复创建幂等；冻结后新增条目入只含新条目的排队批次 | P0 | 通过 |
| Z02d-r | 上限设置已移除：`createBatch` 忽略多余 `limit` 入参（0/101 不再抛「上限」错）；存量 `defaults.batchLimit` 不再被读取；`BATCH_LIMIT_*` 常量删除 | P0 | 通过 |
| S2-r | 勾选范围语义不变：空集/非法 ids 报错、已被认领项剔除、勾选集合全量入批（无截断）、记录无 limit | P0 | 通过 |
| Serve-r | `POST /api/batch/create`：`body.limit`（0/101）被忽略不再 400，响应不含 `limit`；`GET /api/batch/current` 响应不含 `limit` | P0 | 通过 |
| UI-r | 创建面板无「批次上限」输入框（`#batchLimit` 不存在）；创建请求体不含 `limit`；运行视图状态行不显示「上限」 | P0 | 通过 |
| 兼容-r | 旧 `settings.json` 含 `defaults.batchLimit`：创建不受影响；设置保存（codex T1）不再补写 `defaults.batchLimit` 且共用计数器保留 | P1 | 通过 |
| 回归-r | 连续批次假 worker 流程（create→next→claim→report→receipt→check，Z07）、幂等排队（Z06/queue/delete）、依赖受阻（BUG-20260906-001 系列）等既有行为不回归 | P0 | 通过 |

对应测试文件与用例映射（均已更新并通过）：

- `scripts/tests/batch-core.test.mjs`：Z02a 改写（全量冻结 + 无 limit 字段 + 新增条目入下一批）；Z02d 改写（忽略 limit 入参/残留配置；常量删除断言）；BUG-20260906-001 系列去掉 `limit: 1` 入参（单候选场景不依赖截断）。
- `scripts/tests/batch-cli.test.mjs`：Z06 新增 CLI `--limit` 非零退出并提示「已移除」；Z07 去掉 `--limit 10`。
- `scripts/tests/impl-scope.test.mjs`：S2 改写（无 limit 断言、勾选全量入批）。
- `scripts/tests/batch-serve.test.mjs`：原 0/101 → 400 断言改为「忽略并照常创建 + 响应无 limit」；current 响应无 limit；创建请求去 limit。
- `scripts/tests/batch-delete.test.mjs`、`batch-queue.test.mjs`：创建请求体去 `{ limit: 20 }`（回归仍通过）。
- `scripts/tests/impl-entry-ui.test.mjs`：E7 去掉上限输入框交互、断言请求体无 limit、面板无 batchLimit；E11 残留的 `value="20"` 断言改为无 batchLimit 断言。
- `scripts/tests/batch-ui.test.mjs`：U6 去「上限输入」，增「无 batchLimit / 不回显上限」断言。
- `scripts/tests/next-batch-entry.test.mjs`：N5 改为「创建函数不含 limit」。
- `scripts/tests/planned-state.test.mjs`：S12 去掉 `#batchLimit` 交互残留。
- `scripts/tests/codex-model-api.test.mjs`：T1 「缺省上限必须保留」改为「不再补写 defaults.batchLimit」。

执行记录：改动前上述新断言确认跑红（Z02a/Z02d/S2/E7/U6/N5/Z06/serve 共 8 处红）；实现后单文件全绿；全量 `npm test` 87 个测试文件 0 失败（首轮偶发 impl-scope S1 / execution-verifier 翻转，复跑均稳定；S1 为既有偶发缺陷，已登记 BUG-20260908-007，与本改动无关）。
