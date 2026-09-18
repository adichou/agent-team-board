# 测试用例 — REQ-20260908-004 回退 CI 看板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | CI 专属文件已删除：lib/ci-store.mjs、web/ci.js、tests/ci-board.test.mjs 不存在 | P0 | 通过（revert-ci-board T1） |
| T2 | index.html 无 CI 页签（data-view="ci"）、无 #ciView、无 /ci.js 引用 | P0 | 通过（revert-ci-board T2） |
| T3 | app.js VIEWS/MODULE_SUB 无 ci、全文件无 ATBCi/ciView 引用 | P0 | 通过（revert-ci-board T3） |
| T4 | server.mjs 无 ci-store import、无 /api/ci/ 路由、无 selfRestart/ATB_BIND_RETRY/ATB_SERVER_CONFIG/writeServerConfig；端口解析为 ATB_PORT \|\| DEFAULT_PORT | P0 | 通过（revert-ci-board T4） |
| T5 | style.css 无 .ci- 样式残留 | P1 | 通过（revert-ci-board T5） |
| T6 | 回归：npm test 全量零失败（workbench-layout W2/default-port V1 契约同步更新） | P0 | 通过（80 文件 0 失败） |

TDD 执行记录：revert-ci-board.test.mjs 先于回退编写并跑红（5/5 失败），回退实施后跑绿（5/5 通过）。
