# 设计 — BUG-20260909-008 不支持选择的列表，去掉全选和全不选按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260908-027**（经 `atb list` 核验存在：「选择功能混乱，需要重构」，in-progress）
- 次要背景：REQ-20260907-004 确立列表头「静态节点、绑定一次」策略，使按钮天然常驻；REQ-20260908-027 引入成对全选/全不选时仅以 `disabled` 收敛非适用档（未做按档隐藏），是灰显死控件直接残留的口径来源。

## 根因分析

`syncAcceptance`（`scripts/web/app.js`）对全选/全不选只做 `disabled` 同步，从不做显隐同步：

```js
const selectBtn = $('#selectOperable');
if (selectBtn) selectBtn.disabled = busy || !LANE_SELECTION[lane] || operableInCurrentLane().length === 0;
const selectNoneBtn = $('#selectNone');
if (selectNoneBtn) selectNoneBtn.disabled = busy || curCount === 0;
```

`LANE_SELECTION` 仅映射 submitted / accepted / planned 三档；开发中 / 待测试 / 已完成档下两按钮恒为灰显禁用但可见，与行首无复选框的事实矛盾，也与同一列表头内 `#selGroup`（零勾选整体隐藏）、`#laneQuickEntry`（仅已接受/已计划档显示）的按档显隐口径不一致。根因是 REQ-20260908-027 落地时只收窄了作用范围与可用性，未补按档显隐分支。

## 方案

**实现方式：保留静态节点，按档 `toggle('hidden')`**（不改条件渲染）：

- `scripts/web/app.js` `syncAcceptance` 内新增 `laneSelectable = Boolean(LANE_SELECTION[lane])`；`#selectOperable` / `#selectNone` 各加 `classList.toggle('hidden', !laneSelectable)`，`disabled` 逻辑保持原式（隐藏态仍禁用，防键盘焦点触达死控件）。
- 显隐由 `syncAcceptance` 每轮同步（切档即时、轮询只改控件态不重建容器，无闪烁），与 `#selGroup` / `#laneQuickEntry` 口径一致。
- 静态 HTML 位次不变（`#laneQuickEntry` 仍在 `#selectNone` 之后），`lane-quick-entry-20260909-007.test.mjs` Q1 位次契约不受影响；`index.html` 仅补注释说明按档隐藏口径。
- 选择档（待接受/已接受/已计划）行为零改动：全选叠搜索（REQ-20260907-009）、全不选仅清当前档（REQ-20260908-027 / BUG-20260907-016 跨档保留）、批量进行中防误触均保留。

**受影响测试清单**（TDD：先跑红后跑绿）：

- `scripts/tests/selection-lane-scope.test.mjs`
  - S2 增补：三个选择档断言两按钮不隐藏；`developing/confirming/done` 档断言两按钮 `hidden`（原先仅断言 `#selGroup` 隐藏）。
  - 新增 S13：切档即时隐藏/恢复、勾选跨档保留、静态位次与绑定契约。
- `scripts/tests/impl-entry-ui.test.mjs`
  - N3 口径更新：非选择档由「`disabled` 应禁用」改为「`hidden` 应隐藏」（两按钮各一条断言）。
- 未受影响复核：`lane-quick-entry-20260909-007.test.mjs`（Q1 位次契约）、`selection-bar-merge.test.mjs`（M9 禁用断言均在选择档内）、`accept-ui.test.mjs`、`plan-batch-move.test.mjs`（断言均在选择档或走具名函数）——全量 `npm test`（`node scripts/tests/run-all.mjs`）118 文件全绿。

## 风险与边界

- 隐藏态按钮仍保留 `disabled`（双保险），键盘 Tab 不可触达；绑定仍为静态一次性，无重复绑定风险。
- 不动 BUG-20260909-006 口径（已计划档勾选仅服务「移出计划」），不动 REQ-20260909-007 快捷入口文案与显隐。
- `#selectNone` 静态 `disabled` 属性保留：默认档（待接受）首帧即选择档，无需初始 `hidden`；首帧前由 `syncAcceptance` 首轮同步兜底。
- 深浅色 / 无 CSS 场景：`.hidden { display:none !important }`（style.css 第 82 行）为全局既有约定，无新增样式。
