# 设计 — BUG-20260908-024 已计划界面中的单子不需要再显示已计划标签了

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-010（引入「已计划」状态分类与批量开发档位：`LANES` 增设 `planned` 档、`LANE_LABEL['planned'] = '已计划'`；列表卡片模板 `reqRowEl` 沿用 REQ-20260907-004 的通用 lane chip 渲染 `<span class="state s-…">${LANE_LABEL[lane]}</span>`，导致已计划档内每张卡片渲染与所在档位完全重复的「已计划」chip。经 `atb list` 核验 REQ-20260908-010 在册。）

## 根因分析

需求视图列表恒按档过滤（`applyReqFilter`：`items.filter((it) => laneOf(it) === state.reqFilter)`），`planned` 条目只会出现在「已计划」档内。而 `reqRowEl` 卡片模板对六个 lane 一律渲染状态 chip：

```js
<span class="state s-${it.status}">${LANE_LABEL[lane]}</span>
```

于是「已计划」档内每张卡片的标签与档位名称逐字重复，无任何增量信息，只占用 `.card-top` 空间、制造视觉噪音。同类冗余此前已有两处收敛先例（已接受档 chip 语义化、待测试角标与 lane chip 去重），本 Bug 是同一方向的遗漏：REQ-20260908-010 增设 planned 档时未对卡片模板做档内去重收敛。

## 方案

对 `reqRowEl`（`scripts/web/app.js`）中 planned 分支收敛——lane 为 `planned` 时不渲染状态 chip，其余五档不变：

```js
${lane === 'planned' ? '' : `<span class="state s-${it.status}">${LANE_LABEL[lane]}</span>`}
```

状态语义不丢失的承接路径：

- 行悬停提示保留 `LANE_HINT.planned`（「已排入开发计划，开发启动后最旧优先处理」）；
- 详情抽屉状态字段仍按 `STATE_LABEL` 显示「已计划」（抽屉可从任意入口打开，状态是必要上下文，不受本收敛影响）；
- 卡片其余信息（planned 复选框、单号、标题、认领者、更新时间）全部保留。

新增契约测试 `scripts/tests/planned-chip-dedup.test.mjs`（TDD：先写 T1 跑红复现，再实施收敛跑绿），并覆盖其余五档 chip、悬停提示、抽屉状态字段的回归护栏。

## 风险与边界

- `.card-top` 为 flex + wrap 布局，chip 为行内元素，移除不引起布局塌陷（视觉验收点）。
- 全局搜索 / 下属 Bug 列表等其他渲染面不走 `reqRowEl`，不受影响；`reqRowEl` 仅被需求视图列表（`list.replaceChildren(...items.map(reqRowEl))`）调用。
- 若未来出现「全部」档或跨档列表，planned 行将无 chip 且无档位上下文——届时需重新评估（当前筛选条无「全部」档，BUG-20260907-016 已明确该口径）。

## 实施记录

- `scripts/web/app.js` `reqRowEl`：lane chip 渲染加 `lane === 'planned' ? '' : …` 收敛，并留注释引用本 Bug 编号。
- `scripts/tests/planned-chip-dedup.test.mjs`：新增 4 用例（T1 收敛 / T2 五档回归 / T3 悬停提示 / T4 抽屉状态字段）。
- 回归：`planned-state`、`impl-entry-ui`、`accepted-batch-entry`、`card-flag-dedup` 四套全绿；全量 `run-all.mjs` 100 个测试文件失败 0。
