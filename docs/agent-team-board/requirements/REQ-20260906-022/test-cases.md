# 测试用例 — REQ-20260906-022 批次结束后在看板提供创建下一批入口

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 实现文件：`scripts/web/app.js`；测试：`scripts/tests/next-batch-entry.test.mjs`（UI 静态契约）。
> 服务端「finished 批次后可创建新批次」由 `scripts/tests/batch-core.test.mjs` 既有用例覆盖，不重复建。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 运行视图入口：批次 finished 且待处理 0 时渲染完成通知与「创建下一批」按钮（id=batchNext） | P0 | ✅ 通过 |
| N2 | 未结束批次不显示：按钮标记仅在 batchDone（status==='finished' 且 remaining===0）分支内出现，条件同时约束状态与待处理数 | P0 | ✅ 通过 |
| N3 | 复用创建流程：#batchNext 绑定 createBatchAndCopy，同一 /api/batch/create、携带当前勾选 ids、复制提示词 | P0 | ✅ 通过 |
| N4 | 幂等不误导：res.created===false 时提示「未新建批次」，不出现「已创建」误报 | P1 | ✅ 通过 |
| N5 | 上限缺省一致：运行视图无 #batchLimit 输入时 limit 回退创建面板同款默认（勾选 N→N，未勾选→20） | P1 | ✅ 通过 |

- 2026-09-06：N1–N5 全绿（`node scripts/tests/next-batch-entry.test.mjs`）；浏览器实测：本机 batch-20260906-001（已结束、待处理 0）抽屉显示完成通知 +「创建下一批」按钮，未点击创建（避免在真实项目建批），创建行为由 N3–N5 契约与 batch-core 服务端用例保障。
- 全量回归：42 个测试文件仅 `detail-close-btn.test.mjs` T2 失败——**存量问题**（改动前即失败，批量抽屉头部残留 space-between），已另有在册 Bug（BUG-20260906-011/012/013），本次误重复登记 BUG-20260906-016 已标注待人工忽略。
