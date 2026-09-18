# 测试用例 — REQ-20260907-006 去掉全部需求的过滤条件

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 专属测试：`scripts/tests/req-filter-removed.test.mjs`；同步更新 5 个既有契约测试。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 静态契约：index.html 无 `#filterBar`；app.js 无 `REQ_FILTERS`/`renderFilterBar`/`reqFilter`/`applyReqFilter`；style.css 无 `.filter-bar`/`.filter-chip`/`.filter-count` | 高 | ✅ |
| T2 | 行为：`visibleItems()` 返回全部条目（各状态均含，不再按 lane 过滤） | 高 | ✅ |
| T3 | 行为：搜索仍过滤列表；零结果空态文案只提搜索不提「筛选」 | 高 | ✅ |
| T4 | 行状态展示保留：`laneOf`/`LANE_LABEL` 不回归（confirm-lane T2/T3 行标签断言保留） | 高 | ✅ |
| T5 | 讨论模块筛选不受影响：oncall.js `oc-filter` 机制保留 | 中 | ✅ |
| T6 | 既有契约测试同步更新（workbench-layout W5、confirm-lane T3/T5、pending-alignment R5、view-tabs-style V3、refresh-default-view 初始 hidden 集合） | 高 | ✅ |
| T7 | `npm test` 全量回归通过 | 高 | ✅ |
