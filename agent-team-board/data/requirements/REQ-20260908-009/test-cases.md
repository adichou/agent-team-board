# 测试用例 — REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | CLI：`atb new bug "x" --req <REQ>` 退出非 0，报错含「独立」与「引入来源」指引 | P0 | 通过 |
| B2 | CLI：`atb new bug "x"` 正常创建，`--parent` 同样报错；help 文案不再出现 `--req` 创建归属用法 | P0 | 通过 |
| B3 | core：`createItem({type:'bug', parent})` 抛 AtbError；不带 parent 创建后 `status.parent === null`、目录在顶层 `bugs/` | P0 | 通过 |
| B4 | core：新建 Bug 生成 README.md 与 design.md；README 无「归属需求」行；design.md 含「引入来源」节及「未定位（排查过程」指引 | P0 | 通过 |
| B5 | server：`POST /api/new` type=bug 带 parent 返回 400；不带 parent 正常 201 | P1 | 通过 |
| B6 | web：index.html 无 `fParent`，app.js 提交体不含 parent 字段 | P1 | 通过 |
| B7 | 兼容：`createItem` 独立 + `moveBug --req` 构造的存量归属 Bug 可被 resolveItemDir/list 读取；`moveBug --standalone` 可改回独立 | P1 | 通过 |
| B8 | SKILL.md：new bug 用法不再宣传 --req，改述一律独立 + 引入来源（附加文档同步用例） | P1 | 通过 |

新增测试文件：`scripts/tests/bug-standalone-origin.test.mjs`（8 用例全绿）。
同步调整的既有测试：`batch-core.test.mjs` Z03、`item-delete.test.mjs` D2/D4、`rename-reject.test.mjs` R2、
`search-api.test.mjs`（构造归属 Bug 改走 `createItem` 独立 + `moveBug`）；`traceability.test.mjs` R2/R4、
`workbench-layout.test.mjs` W6（归因落点与新表单行为的契约随规范演进更新）。
全量回归：`node scripts/tests/run-all.mjs` 82 个测试文件全部通过。
