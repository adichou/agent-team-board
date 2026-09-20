# BUG-20260906-016 detail-close-btn T2 失败：批量抽屉头部残留 space-between 内联布局

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T14:39:54.772Z

## 现象

npm test（node scripts/tests/run-all.mjs）中 scripts/tests/detail-close-btn.test.mjs 用例 T2「旧布局移除」失败：契约要求 app.js 全局不得再有 justify-content:space-between 内联布局（REQ-20260906-005 移除条目详情头部旧两端布局），但 renderBatchDrawer() 批量抽屉头部（scripts/web/app.js:1273）残留一处 style 内联 space-between，违反全局契约。

复现：node scripts/tests/detail-close-btn.test.mjs → T2 失败，exit 1。

修复方向：批量抽屉头部改用与条目详情头部一致的类样式（.drawer-head/.card-top）承载两端布局，消除内联 space-between；改后 detail-close-btn 全绿。

发现于 REQ-20260906-022 全量回归（该失败在本次改动前已存在，与 022 改动无关）。

## 重复登记说明（2026-09-06）

登记后核对看板发现同日已有三个在册 Bug 覆盖同一问题（登记时未先查重，属流程失误）：

- BUG-20260906-011「npm test 回归：detail-close-btn T2 被批量实施抽屉的 space-between 连带击穿」（accepted）
- BUG-20260906-012「detail-close-btn 契约测试 T2 断言范围过宽：批量抽屉头部内联 space-between 导致全量回归常红」（accepted）
- BUG-20260906-013「detail-close-btn T2 回归：批量实施抽屉头部重新引入 space-between 内联布局」（accepted）

本单与上述重复，请人工忽略/删除本单（保留 011/012/013 处理即可）。

## 复现步骤

1.

## 期望行为
