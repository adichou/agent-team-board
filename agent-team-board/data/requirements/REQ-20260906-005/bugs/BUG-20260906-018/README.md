# BUG-20260906-018 detail-close-btn T2 全文件断言误伤批量抽屉的 space-between（存量失败）

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-005
- 创建：2026-09-06T15:09:59.112Z

## 现象

全量回归（docs/agent-team-board/dispatch/runs/run-20260906-006/）发现 scripts/tests/detail-close-btn.test.mjs 的 T2 对整个 scripts/web/app.js 做 doesNotMatch /justify-content:space-between/，而 renderBatchDrawer()（app.js 约 1273 行）批量抽屉头部合法使用内联 space-between，导致 T2 恒失败、npm test 整体转红。app.js 最后修改时间 2026-09-06 22:38，早于本次会话；与 BUG-20260906-001 修复（仅 scripts/lib/batch.mjs、scripts/atb.mjs 计数行、batch-core 测试）无关。建议把 T2 断言范围收窄到 renderDrawer 的 drawer-head 模板块，与 T1 的 drawerHeadBlock() 口径一致。

## 复现步骤

1. 登记时点（2026-09-06 15:09 前后）：`node scripts/tests/detail-close-btn.test.mjs` 的 T2 对整个 `scripts/web/app.js` 做 `doesNotMatch /justify-content:space-between/`，而 `renderBatchDrawer()`（约 1273 行）批量抽屉头部合法使用内联 space-between，T2 恒失败，`npm test` 整体转红。

## 期望行为

1. T2 断言口径收窄到 renderDrawer 的 drawer-head 模板块（与 T1 的 drawerHeadBlock() 一致），不再误伤批量抽屉；
2. `node scripts/tests/detail-close-btn.test.mjs` 与 `npm test` 全绿。

## 排查结论（本次核验）

- 时间线：本 Bug 登记（2026-09-06 15:09）之后，BUG-20260906-011（16:14 上报）已把 T2 断言收窄到 renderDrawer 函数体；BUG-20260906-016（19:24 上报）进一步把 renderBatchDrawer 头部改为 `.batch-head` 类承载两端布局并新增 T5 全局断言。两步修复已完整覆盖本 Bug 诉求。
- 现状核验（2026-09-07）：`detail-close-btn.test.mjs` T1–T5 全绿；全量 `npm test` 57 个测试文件失败 0。本 Bug 描述的失败在当前代码已不存在，无需再改代码。

## 关联（引入来源）

- 引入来源：REQ-20260906-005（其 detail-close-btn.test.mjs 原始 T2 用例对 app.js 全文件断言不出现 `justify-content:space-between`，属过度断言；误伤 REQ-20260906-002 引入的 renderBatchDrawer() 批量抽屉头部合法内联两端布局，致 T2 恒失败、npm test 整体转红）。
- 实际修复由 BUG-20260906-011（T2 断言收窄至 renderDrawer）与 BUG-20260906-016（批量抽屉头部改 .batch-head 类承载、恢复 T5 全局断言）完成；本条目本次仅核验确认已修复并归因结案。
