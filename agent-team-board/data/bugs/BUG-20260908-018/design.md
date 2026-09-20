# 设计 — BUG-20260908-018 执行记录为什么没有显示完所有的单

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260907-003（已核验：`atb list` 中存在，in-progress「需求完善：待接受需求与 Bug 批量补全文档…」）。
  完善面板的执行记录能力由该需求引入：`refineSummary()` 当时即按 `{ offset: 0, limit: 5 }`
  取首屏记录且不返回 `total`，前端 `refineRecordsHtml()` 原样渲染、无分页入口——
  面板上线时未对齐开发批次面板（REQ-20260906-002）已有的 `recordsTotal` + 「加载更多」交互。

## 根因分析

1. 后端源头截断：`scripts/lib/refine-store.mjs` `refineSummary()` 以 `{ offset: 0, limit: 5 }`
   调用 `listRefineRuns()` 并丢弃返回的 `total`；`/api/refine/current`（`scripts/server.mjs`）
   原样透传这 5 条、无总数字段。
2. 前端无补齐手段：`scripts/web/app.js` `refineRecordsHtml()` 直接渲染 `state.refine.data.records`，
   无「共 N 条」提示、无「加载更多」按钮；既有分页接口 `/api/refine/records`（支持 offset/limit，
   上限 100）前端从未调用。
3. 表观矛盾：同面板「计数」行（done/failed/skipped 合计）可以远大于 5，两处口径对不上。

## 方案

对齐开发批次面板 `recordsHtml()` 的分页交互，三层各一点：

1. `refine-store.mjs` `refineSummary()`：保留首屏 `limit: 5`（性能口径不回归），
   但接收 `listRefineRuns()` 的 `total`，返回体新增 `recordsTotal`。
2. `server.mjs` `/api/refine/current`：透传 `recordsTotal`。
3. `app.js`：
   - `refineRecordsHtml()` 底部渲染 `records.length < total` 时
     「加载更多（x/N）」按钮（`#refineMoreRecords`），否则「共 N 条」；
     兼容缺 `recordsTotal` 的旧后端（回退已渲染条数，不误报按钮）。
   - 新增 `loadRefineRecords()`：点击经既有 `/api/refine/records` 增量拉取（每页 10 条），
     局部更新 `#refineRecordsArea` 并重绑按钮。
   - `state.refine` 增加 `recordsBatchId` / `recordsLoaded`：主轮询 `refreshRefine()` 在同批次
     且已加载深度 > 首屏时，按已加载深度经分页接口全量重取，刷新不丢失已加载记录；
     换批自动重置回首屏深度。

## 风险与边界

- 增量 offset 与开发批次 `loadBatchRecords()` 同模式：轮询间隙新产生记录时理论上可能重复/错位，
  与既有面板口径一致，不在本 Bug 范围。
- `/api/refine/records` 单页上限 100（服务端既有约束），「加载更多」每页 10 条不受影响。
- `refineSummary()` 返回体增大一个数字字段，check ≤2KiB 约束不受影响（records 仍为 5 条）。
