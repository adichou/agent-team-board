# 测试用例 — REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | core.renameItem：submitted 需求改标题成功，status.title 更新、history 留痕、README/design/test-cases 首行同步 | P0 | 通过 |
| R2 | core.renameItem：submitted Bug（独立与归属需求）同样可改标题且 README 首行同步 | P0 | 通过 |
| R3 | core.renameItem：accepted / in-progress / done 状态拒绝改标题并报错 | P0 | 通过 |
| R4 | core.renameItem：空标题、超 120 字、与原标题相同均拒绝 | P1 | 通过 |
| R5 | core.setStatus：accepted → submitted 驳回成功，history 留痕 | P0 | 通过 |
| R6 | core.setStatus：in-progress / done → submitted 拒绝（不可跳级驳回） | P0 | 通过 |
| R7 | server：POST /api/item/:id/title 改标题成功；非 submitted 返回错误；boardTransitionAllowed 放行 accepted → submitted 并拒绝 in-progress → submitted | P0 | 通过 |
| R8 | CLI：atb rename 子命令登记于 usage 并调用 core.renameItem | P1 | 通过 |
| U1 | UI：submitted 卡片与详情页渲染「改标题」按钮；renameItem 提交 POST /api/item/:id/title 并刷新 | P0 | 通过 |
| U2 | UI：详情页 accepted 状态渲染「驳回接受」按钮；ACTION_LABEL/ACTION_UNDO 覆盖 accepted → submitted（接受可撤销） | P0 | 通过 |
| U3 | UI：非 submitted 状态不渲染改标题按钮；uiPrompt 为页面内异步对话框（不用同步 window.prompt） | P1 | 通过 |

执行文件：`scripts/tests/rename-reject.test.mjs`（core 集成 + 真实服务 HTTP + CLI/UI 静态与沙箱契约，
模式对齐 actor-name / dispatch-api / pending-accept-inline / accept-ui 既有测试）。

## 执行记录

- 2026-09-08 TDD 红：12 用例失败 11（R8 的 usage 断言中 `core.renameItem(` 在实现前即存在一处误匹配，
  其余全红）；实现后绿：12/12 通过。
- 联动更新三个既有契约测试（契约演进，非掩盖回归）：
  - `drawer-undo.test.mjs` T2：接受操作撤销映射按 REQ-20260907-011 新增 accepted → submitted；
  - `pending-alignment.test.mjs` R1：TRANSITIONS.accepted 断言补入人工回退边 'submitted'；
  - `pending-accept-inline.test.mjs` T4：紧凑按钮样式断言适配 `.card-accept-btn, .card-rename-btn` 选择器组。
- 全量回归：`npm test` 72 个测试文件失败 0（execution-verifier 曾出现一次偶发时序失败，
  单独执行与全量复跑均通过，与本改动无关——本改动未触碰 report/核对链路）。
