# 设计 — BUG-20260909-007 详细页面的返回按钮多余，因为已经有关闭按钮了

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**REQ-20260907-004**（窄屏覆盖式抽屉 + 返回入口）。该需求在需求 / Bug 详情抽屉头部新增「← 返回」按钮（`#drawerBack`），与既有「✕」关闭按钮（REQ-20260906-005 定位单号紧右侧）并存且点击行为完全相同（同一 `closeDrawer()`）。编号经 `atb list` 核验真实存在（2026-09-09，与 README 头部一致）。

## 根因分析

REQ-20260907-004 实现窄屏覆盖式抽屉时，把「返回列表」当作与「关闭」不同的动作来设计，给需求侧详情头部加了 `#drawerBack` 按钮（仅 ≤1020px 可见）。实际上窄屏下详情覆盖在列表之上，「返回」与「关闭」本就是同一动作（`closeDrawer()`：抽屉收起、遮罩消失、露出列表），按钮点击处理也确实直接复用了同一个 `closeDrawer`，无任何状态或滚动差异。宽屏（>1020px）该按钮被 CSS `display: none` 隐藏、只剩「✕」，进一步证明返回按钮并无独占能力，纯属冗余出口；三处静态契约测试（drawer-height D4、workbench-layout W4、portrait-board P2）随后把这一冗余现状固化了下来。

## 方案

精确移除需求侧冗余出口，保留共用样式的讨论侧使用：

1. `scripts/web/app.js`：
   - 删除 `renderDrawer()` 中 `#drawerBack`「← 返回」按钮标记（原第 2179 行）；
   - 删除其事件绑定 `$('#drawerBack')?.addEventListener('click', closeDrawer)`（原第 2241 行），`#drawerClose` 绑定注释更新为唯一头部关闭出口。
2. `scripts/web/style.css`：**保留** `.drawer-back` 顶层规则（原第 451 行 `display: none`）与 ≤1020px 媒体查询内 `display: inline-flex`（原第 728 行）——该类同时被讨论模块 `#ocBack`（`scripts/web/oncall.js` 第 330 行）使用，且返回是讨论详情抽屉的唯一出口（该处无并存 ✕），删除规则会误伤讨论侧。仅更正两处提到「返回入口」的注释为讨论侧专用口径，并标注 BUG-20260909-007。
3. 测试同步更新（TDD 先红后绿）：
   - `scripts/tests/drawer-height.test.mjs` D4：新增 `app.js` 不得含 `drawerBack` 断言；`.drawer-back` 规则断言保留但改口径为「讨论模块 #ocBack 使用」；
   - `scripts/tests/workbench-layout.test.mjs` W4：`/drawerBack/` 由 match 改为 doesNotMatch，新增 `#drawerClose` 存在与 oncall `#ocBack` 保留断言；
   - `scripts/tests/portrait-board.test.mjs` P2：同上，新增 js 无 `drawerBack` 断言，CSS 规则断言保留改口径。

关闭出口收敛结果：头部「✕」+ 键盘 Escape + 点击遮罩，三条路径全部走既有 `closeDrawer()`，行为不变。

## 风险与边界

- `.drawer-back` 为需求侧与讨论侧共用类，本次仅动 `app.js` 标记与绑定、不动规则本体，讨论侧 `#ocBack` 窄屏显隐与点击返回不受影响（回归已断言）。
- 批次抽屉 `#batchClose`（单出口，无冗余）不在范围，未改动。
- 宽屏并排布局、✕ 位置（REQ-20260906-005 单号紧右侧）、`refreshDrawer` 失败 toast 后关闭等既有行为均未触碰。
- 全量 `node scripts/tests/run-all.mjs`：117 个测试文件全部通过，无红灯。

## 实施记录

- 2026-09-09（zcode-batch-022-1，批次 batch-20260909-022）：按上述方案完成移除与测试更新；三处契约测试先改断言跑红（D4/W4/P2 各 1 例失败），实施后全绿，全量 117 个测试文件 0 失败；`node --check` 语法通过；`scripts/web/` 下无 `drawerBack` 残留。
