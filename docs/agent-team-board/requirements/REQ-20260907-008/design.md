# 设计 — REQ-20260907-008 讨论视图精简：删除头部说明区，状态筛选与需求栏样式统一并去掉「全部」

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

讨论视图（oncall.js）头部 `header.oncall-head`（标题 + 两行说明 + 「＋ 新建讨论单」按钮）占约两行高度；
顶栏已有统一「＋ 新建」入口（REQ-20260907-004，含需求 / Bug / 讨论单三类），头部按钮冗余。
状态筛选条使用 `chip oc-filter`（计数为纯文本、active 用 inset 描边 `.oc-filter.active`），
与需求栏 `filter-chip + filter-count`（viewrail-accent 描边 + 浅底色，app.js renderFilterBar）不一致。
需求栏已去「全部」档（REQ-20260907-006 + BUG-20260907-016），讨论视图保留「全部」口径不一致。

## 方案

仅前端 `scripts/web/oncall.js` 与 `scripts/web/style.css`，不动后端 API 与数据结构：

1. **删头部**：`renderView()` 移除 `header.oncall-head` 整块（含 `#ocNew` 按钮及其事件绑定）。
   新建讨论单统一走顶栏「＋ 新建」（类型选讨论单，既有 app.js openModal('ask') 链路不变）。
   空态引导文案由「点击右上『＋ 新建讨论单』」改为指向顶栏「＋ 新建」。
2. **筛选样式统一**：筛选 chips 由 `chip oc-filter` 改为与需求栏完全一致的
   `filter-chip` + 计数 `<span class="filter-count">`（复用 style.css 既有规则，active 由
   `.filter-chip.active` 提供 viewrail-accent 描边与浅底）；事件选择器 `.oc-filter` 改 `.filter-chip`。
   失败 chip 额外保留 `oc-failed` 修饰类（红色描边，特异性低于 `.filter-chip.active`，行为不变）。
   style.css 删除死规则：`.oncall-head`、`.oncall-title h2`、`.oncall-title .muted`、`.oc-filter`、`.oc-filter.active`；
   保留 `.oncall-filters`（容器）与 `.oc-failed`（详情轮次错误徽标仍在用）。
3. **去「全部」**：`FILTERS` 删除 `['all', '全部']`，保留 待回复 / 回复中 / 已回答三档，
   失败单存在时条件渲染「失败」chip（原逻辑不变）；`state.filter` 缺省值 `all` → `pending`（第一个筛选）。
   `renderList()` 删除 `state.filter === 'all'` 的全量分支。

### 测试策略

- 新增 `scripts/tests/oncall-view-lean.test.mjs`：静态契约（无头部/无 oc-filter 样式/chip 结构）+
  vm 加载 oncall.js 的行为测试（fetch stub 返回 board → 断言渲染 innerHTML：无「全部」chip、
  缺省选中「待回复」、filter-count 计数、失败 chip 条件出现、空态文案指向顶栏「＋ 新建」）。
- 同步更新 `req-filter-removed.test.mjs` T5：`oc-filter` 断言改为 `filter-chip`
  （本需求弃用 oc-filter 样式，旧断言随契约演进更新；容器 `oncall-filters` 断言保留）。
- `oncall-ui.test.mjs` U3 空态断言（`创建第一条`）与新文案保持匹配，无需改动。

## 风险与边界

- `reveal(id)` / 统一新建 / 派单 / 抽屉逻辑不涉及头部与筛选样式，不受影响。
- 计数随既有 2 秒轮询（poll → renderView）刷新，无需新增机制。
- 窄屏（filter-chip 自带 flex-wrap）与深浅色主题（filter-chip 使用 CSS 变量）无回归。
