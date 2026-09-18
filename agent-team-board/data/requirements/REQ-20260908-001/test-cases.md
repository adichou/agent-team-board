# 测试用例 — REQ-20260908-001 任务看板的批次记录上，需要显示每个单的标题，放到单号的后面

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | listRuns 记录带 title：创建带标题条目入批并产生运行（reported 收尾）后，records 中该条记录 `title` 等于条目标题 | P0 | 通过（batch-core） |
| T2 | listRuns 容错：条目目录被删除后调用 listRuns 不抛错，记录 `title` 为空串 | P0 | 通过（batch-core） |
| T3 | listRuns 兼容：既有字段 runId/itemId/owner/result/reason/reportRef/at 原样保留（字段级断言） | P1 | 通过（batch-core） |
| T4 | recordsHtml 静态契约：单号后渲染标题（`shortOwner(r.title …)` 且带 title 属性悬停全文） | P0 | 通过（batch-ui U15） |
| T5 | recordsHtml 搜索：过滤数组包含 `r.title`，按标题关键字可命中批次记录 | P1 | 通过（batch-ui U15） |

T1–T3 位于 `scripts/tests/batch-core.test.mjs`（用例名 REQ-20260908-001），T4–T5 位于 `scripts/tests/batch-ui.test.mjs`（U15）。
全量回归：`node scripts/tests/run-all.mjs` 76 个测试文件全部通过。
