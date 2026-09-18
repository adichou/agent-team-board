# BUG-20260906-011 npm test 回归：detail-close-btn T2 被批量实施抽屉的 space-between 连带击穿

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T08:02:46.493Z

## 现象

现象：npm test 34 个文件中 detail-close-btn.test.mjs 失败（T2 旧布局移除），其余全绿；REQ-20260906-017 批量接受实现本身 11 个用例全绿。

排查：T2 断言 assert.doesNotMatch(js, /justify-content:space-between/) 作用于整个 app.js 全文；而 renderBatchDrawer()（scripts/web/app.js 约 1055 行，批量实施抽屉头部）使用了内联 justify-content:space-between。时间线：REQ-20260906-005 测试写于 11:52 并 11:56 报告通过；REQ-20260906-002 批量实施于 14:41 报告，其 renderBatchDrawer 引入该内联布局后 T2 开始失败——即 002 合入时击穿了 005 的静态契约，非 017 引入。

修复方向（二选一，修复时定）：收窄 T2 断言范围到 renderDrawer 的 drawer-head 模板块内；或把批量抽屉头部的内联布局改为专用 class 并同步收窄断言。需回归 005 的 T1–T4 与 002 的 batch-ui 测试。

## 复现步骤

1. `npm test`（即 `node scripts/tests/run-all.mjs`）。

## 期望行为

detail-close-btn.test.mjs 的 T1–T4 全部通过：REQ-20260906-005 的静态契约只约束详情抽屉 `renderDrawer` 的头部模板块，不受批量抽屉 `renderBatchDrawer` 内联布局影响；其余 42 个测试文件保持全绿。

## 修复记录（2026-09-07，zcode-batch-002-1）

采用「收窄断言范围」方案（生产代码零改动）：`scripts/tests/detail-close-btn.test.mjs` 新增 `renderDrawerJs()` 辅助函数截取 `function renderDrawer()` 函数体；`drawerHeadBlock()` 与 T2 的两处 app.js 全文件级断言（`justify-content:space-between` 不存在、`card-top` 关闭后紧跟 `<h2>`）全部收窄到该函数体内。附带修复一个潜在脆弱点：原 `drawerHeadBlock()` 取 app.js 中第一个 `drawer-head` 头部，若 renderBatchDrawer 被移动到 renderDrawer 之前会静默断言错误的模板块，现固定在 renderDrawer 作用域内取块。验证：本文件 4/4 通过，全量 `npm test` 43 个文件失败 0。

## 关联

- 引入来源：REQ-20260906-002（renderBatchDrawer 批量抽屉头部引入内联 `justify-content:space-between`，合入时击穿 REQ-20260906-005 写于其前的全文件级 T2 静态断言；断言作用域过宽为根因，两 ID 均经 `atb list` 核验存在）