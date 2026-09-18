# 设计 — REQ-20260910-008 选择区域布局优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状（`scripts/web/index.html` 的 `#reqCaption` + `scripts/web/app.js` 的 `renderBoard`/`syncAcceptance`）：

- 列表头固定两行（REQ-20260909-002 合并后、BUG-20260909-009 改造为 `.caption-info` + `.caption-select #selectRow`），
  行 1 放「N 个条目」计数、排序与档位快捷入口，行 2 放全选 / 全不选 / 已选数量与批量动作。
- 顶部分类标签（`renderFilterBar`）已按档展示数量，列表头「N 个条目」与之重复；
  第二行选择区在未勾选时占一整行空高度。

## 方案

纯前端布局调整，改 `scripts/web/index.html` / `scripts/web/style.css` / `scripts/web/app.js` 三处，接口与服务端不动：

1. **单行工具栏**：`#reqCaption` 由固定两行改回单行 flex（`flex-wrap: wrap` 兜底窄屏按组换行）。
   控件左起：排序 `#reqSort` → 全选 `#selectOperable` → 全不选 `#selectNone` → 已选数量与批量动作 `#selGroup`
   → 档位快捷入口 `#laneQuickEntry`（`margin-left: auto`，空间足够时靠右）。
   删除 `#selectRow` 包裹层与 `.caption-info` / `.caption-select` / `.caption-row` 行结构；
   三个不可选择档（开发中 / 待测试 / 已完成）由 `syncAcceptance` 按控件粒度整体隐藏，无空占位。
   零选择保留全选 / 全不选；`#selGroup` 仍按「当前档勾选数 > 0」显隐——宽度足够时右组在同一行内出现 / 消失，
   不增加工具栏行数（`#selGroup` 保持无 `margin-left:auto`，与全选 / 全不选连续，快捷入口才靠右）。
2. **去重复计数**：普通「N 个条目」从列表头移除（分类标签已展示各档数量）。
   `#reqCount` 节点保留但转为条件提示（无提示时 `hidden`）：
   - 已完成档默认截断（未搜索且总量 > 100）：保留「`N / M 个条目（已完成默认仅显示最新 100 项，更早请用搜索获取）`」；
   - 搜索生效（关键词非空且结果已到）：显示「`搜索命中 N 项`」——命中数明确标注为搜索结果，
     不把分类总数误称为命中数；结果未到（防抖 / 在途）不显示提示，避免全量被误称命中。
3. **交互与状态语义不动**：排序偏好记忆、按档隔离选择（全选 = 当前档叠搜索、全不选清当前档）、
   批量动作按档显隐、进行中防重复提交、部分成功失败清单、空态文案、`#acceptResult` 结果区位置均维持既有行为。
4. **ui-demo.html**：条目目录内自包含离线演示（无外链脚本 / 样式 / 字体），覆盖六档切换、排序、
   勾选 / 全选 / 全不选、按档动作与快捷入口、宽窄屏换行与正常 / 空 / 加载 / 失败四态。

被取代的旧结构契约（两行结构、`.caption-info` 位次、`.req-caption` 纵向排布）同步改写为单行工具栏契约，
行为断言（按档显隐、选择范围、防误触）全部保留。

**开源选型（REQ-20260909-015）**：本次为既有原生 DOM / CSS 的布局与文案调整（flex 单行 + 条件提示），
未引入任何开源库（自研理由：无合适库——纯既有代码内部结构调整，引库成本高于自研且无对应现成能力）；
不创建 licenses.md。

## 风险与边界

- 旧契约测试（`caption-two-row-20260909-009` / `selection-bar-merge` / `lane-quick-entry-20260909-007` /
  `selection-lane-scope`）中编码「固定两行 / `.caption-info`」的静态断言随本需求改写为单行契约；行为断言不动。
- 搜索提示只在结果已到时出现：防抖窗口内列表仍为全量，不提前标注命中数。
- 窄屏按组整体换行依赖 `flex-wrap: wrap` + 按钮不换字（按钮文案为整体文本节点，天然不挤断）。
