# 设计 — REQ-20260908-002 所有列表提供排序功能。已完成的需求或 bug 默认只显示最新的 100 项，其他的需要通过搜索获取

> 由批次实施 Agent 补充（batch-20260908-011 · run-20260908-063）。

## 背景

- `/api/board` → `core.listItems()` 固定 `createdAt` 升序返回全部条目；`/api/oncall/board` →
  `oncall.listTickets()` 同样 `createdAt` 升序。前端 `renderBoard` / `renderList` 直接按服务端
  顺序渲染，无排序入口。
- 已完成条目随时间累积（状态机单向），列表会无限变长；但搜索（REQ-20260906-015 `/api/search`
  覆盖全量条目）已可获取任意旧条目，因此「已完成」列表默认截断为最新 100 项是安全的。

## 方案

纯前端改造（服务端排序不动，`atb list` CLI 保持原序），两个视图各加一个排序下拉 + 一个
共享语义的排序键集合：

### 1. 需求视图（scripts/web/app.js + index.html + style.css）

- `index.html`：`.req-caption` 行内在 `#reqCount` 与「选择可操作项」按钮之间加
  `<select id="reqSort" class="sort-select" title="列表排序">`，五个 option：
  `updated-desc`（最新更新，默认）/ `updated-asc` / `created-desc` / `created-asc` / `id-asc`。
- `app.js`：
  - `REQ_SORTS` 常量（key → 取值函数 + 方向），`loadReqSort()` 从 localStorage `atb.req.sort`
    读初值（try/catch + 白名单校验，非法回退 `updated-desc`），存入 `state.reqSort`。
  - `sortReqItems(items, key)`：稳定比较（时间键比较值，空值当 `''`；同值回退 `id` 比较），
    返回新数组不改入参。
  - `visibleItems()` 改为：档位过滤 → 搜索过滤（`searchVisibleItems`）→ 排序 →
    「已完成档且 `!state.search.q`」时 `slice(0, 100)` 截断。搜索词非空即视为「非默认」，
    不截断（含搜索结果未到时，避免先截断再等结果造成老条目闪断）。
  - `renderBoard()`：截断发生时 `#reqCount` 显示 `100 / N 个条目（已完成默认仅显示最新 100
    项，更早请用搜索获取）`；列表内容签名 `sig` 纳入 `state.reqSort` 与截断后的条目集合
    （条目数组本身在签名里，排序变化自然触发重绘）。
  - 事件绑定区：`#reqSort` change → 写 `state.reqSort` + localStorage + `renderBoard()`。
- `style.css`：`.sort-select` 小尺寸下拉样式（与 `.filter-chip` 同高、muted 配色，
  `margin-left: auto` 仅用于讨论筛选条场景；需求标题行内自然排布）。

### 2. 讨论视图（scripts/web/oncall.js）

- `state.sort`（默认 `loadOcSort()` 读 `atb.oncall.sort`，白名单 `updated-desc` / `updated-asc`
  / `created-desc` / `created-asc`）。
- `renderView()` 筛选条行末渲染 `<select class="sort-select oc-sort">` 并绑定 change
  （写 `state.sort` + localStorage + `renderList()`）。
- `renderList()` 对 `shown`（状态筛选 + 搜索过滤后）应用 `sortTickets(shown, state.sort)`。
- 导出 `setSort(key)` 供测试与外部驱动。

### 3. 不改动

- 服务端任何排序/接口；`atb list` CLI；文件视图；任务/CI 分页列表（设计说明见 README 范围节）。
- 详情抽屉上一条/下一条导航（`navIds`）随看板顺序，排序后与用户所见列表一致，属预期改善。

## 风险与边界

- **默认序从「创建升序」变「更新降序」**：属于本需求的直接目的（最新优先）；既有测试若有
  依赖列表顺序的断言需同步核对（回归 `npm test`）。
- **截断与选择/勾选**：仅「已完成」档截断，该档无勾选/接受控件，不冲突；其他档永不截断。
- **搜索竞态**：截断条件用 `state.search.q`（输入即时置位）而非「结果已到」，搜索词一出现
  即恢复全量池，避免 250ms 防抖窗口内老条目被截断后无法命中。
- **localStorage 不可用**（隐私模式等）：读写均 try/catch，回退默认档，不阻塞渲染。
- oncall `renderView` 每次轮询重绘筛选条：排序下拉选中值从 `state.sort` 渲染，不依赖 DOM 存续。

## 实施记录

- TDD：新增 `scripts/tests/list-sort.test.mjs`（T1–T8），先全量跑红（8/8 红）再实现跑绿（8/8 绿）。
- `scripts/web/index.html`：`.req-caption` 行内新增 `<select id="reqSort">`（五选项，静态骨架）。
- `scripts/web/app.js`：
  - `REQ_SORTS` / `REQ_SORT_DEFAULT` / `REQ_DONE_LIST_LIMIT` / `REQ_SORT_STORAGE_KEY` 常量与
    `loadReqSort()`（白名单校验 + try/catch 回退）、`isReqSortKey()`、`sortReqItems()`（稳定排序，
    时间同值回退单号，不改入参）；
  - `state` 新增 `reqSort: loadReqSort()`；`visibleItems()` 改为「档位过滤 → 搜索过滤 → 排序 →
    已完成档未搜索时截断 100」管线（`renderBoard` 不再重复套 `searchVisibleItems`）；
  - `renderBoard()`：截断时计数行显示 `100 / N 个条目（已完成默认仅显示最新 100 项，更早请用搜索获取）`，
    列表内容签名纳入 `state.reqSort`；
  - 事件绑定区：`#reqSort` 初值同步 + change 重排并写 localStorage。
- `scripts/web/oncall.js`：`SORTS` / `SORT_DEFAULT` / `SORT_STORAGE_KEY` / `loadSort()` / `sortTickets()` /
  `setSort()`（导出）；`state.sort` 初始化；`renderView` 筛选条行末渲染 `.oc-sort` 下拉并绑定；
  `renderList` 对筛选+搜索后的结果排序。
- `scripts/web/style.css`：新增 `.sort-select`（需求标题行内与讨论筛选条行末共用）与
  `.oncall-filters .sort-select { margin-left: auto }`。
- 测试调试记录：vm 沙箱数组与宿主 realm 原型不同，`node:assert/strict` 的 `deepEqual` 会比较原型，
  测试内统一 `[...h.run(...)]` 展开回宿主数组（实现无关，纯测试口径）。
- 回归：`npm test`（run-all.mjs）77 个测试文件失败 0（含新增 list-sort.test.mjs）。
