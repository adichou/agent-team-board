# 设计 — REQ-20260907-006 去掉全部需求的过滤条件

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260907-004 布局重构在需求模块第四行引入状态筛选条：`scripts/web/index.html`
的 `#filterBar` 容器 + `scripts/web/app.js` 的 `REQ_FILTERS`（六档）/
`renderFilterBar()` / `state.reqFilter` / `applyReqFilter()` 与 chips 点击事件委托，
配套 `style.css` 的 `.filter-bar/.filter-chip/.filter-count` 样式。用户要求去掉
该筛选条，列表直接展示全部需求与 Bug。

## 方案

纯前端展示层删减，不动后端 API、状态机与数据：

- `scripts/web/index.html`：删除 `#filterBar` 节点及其注释（第四行整体不再存在，
  不留占位）。
- `scripts/web/app.js`：
  - 删 `state.reqFilter` 初始字段；删 `REQ_FILTERS`、`applyReqFilter()`、
    `renderFilterBar()`；删 `setView()` 与 `renderBoard()` 中的 `renderFilterBar()`
    调用；删 `#filterBar` 的 click 事件委托；`state.listSig` 签名去掉
    `state.reqFilter` 项。
  - `visibleItems()` 保留（3 个调用点：renderBoard / 待接受勾选 / 批量实施资格），
    简化为直接返回 `state.board?.items || []`，注释标注 REQ-20260907-006。
  - `renderBoard()` 空态文案「当前筛选与搜索下没有条目」改为「当前搜索下没有条目」。
  - `laneOf` / `LANE_LABEL` / `LANE_HINT` 保留——行状态标签与 tooltip 仍按派生
    分类展示，与筛选无关。
- `scripts/web/style.css`：删 `.filter-bar`、`.filter-chip`（含 :hover/.active）、
  `.filter-count` 规则及分节注释。
- 契约测试同步：`workbench-layout.test.mjs` W5 改为断言筛选条移除；
  `confirm-lane.test.mjs` T3 去掉 filterBar 段（保留行状态标签断言）、T5 改为
  移除契约；`pending-alignment.test.mjs` R5 的 REQ_FILTERS 断言反转；
  `view-tabs-style.test.mjs` V3 去掉 `.filter-chip` 圆角断言；
  `refresh-default-view.test.mjs` 初始 hidden 集合去掉 `#filterBar`。
  新增 `req-filter-removed.test.mjs`（本需求专属契约 + 行为测试）。

## 风险与边界

- 讨论模块筛选（`oncall-filters` / `oc-filter`）与任务模块筛选不动，仅需求模块。
- `visibleItems()` 语义从「筛选+搜索前的基础集合」变为「全量集合」，调用方
  （搜索过滤、勾选资格、批量资格）行为随筛选移除自然变为全量，符合预期。
- 历史偏好无持久化（reqFilter 仅内存态），无迁移问题。
