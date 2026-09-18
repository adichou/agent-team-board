# 设计 — BUG-20260909-004 不要在列表的每个单的后面加上状态显示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260907-004（看板整体布局优化引入需求列表工作区：其 README「界面展示」第 5 条明确「需求列表主要展示标题、编号、类型、状态、负责人及时间」，`reqRowEl()` 列表行模板自此携带逐条 lane 状态 chip（`<span class="state s-…">LANE_LABEL[lane]</span>`）；BUG-20260908-024 曾局部收敛仅豁免「已计划」档，其余五档保留至今。编号经 `atb list` 核验在册，BUG-20260908-024 README 亦印证「列表卡片模板沿用 REQ-20260907-004 的通用 lane chip 渲染」）

## 根因分析

- 需求模块列表按六档筛选（`applyReqFilter()`：`laneOf(it) === state.reqFilter`），同一档列表内每张卡片的状态标签文字与顶部选中档位完全一致，无增量信息；六档布局由 REQ-20260906-013（五档）+ REQ-20260908-010（增设「已计划」档）定型后，列表行模板仍沿用 REQ-20260907-004 的「行内展示状态」设计，两者叠加形成逐条重复展示。
- 代码位置：`scripts/web/app.js` `reqRowEl()` 模板行 `${lane === 'planned' ? '' : `<span class="state s-${it.status}">${LANE_LABEL[lane]}</span>`}`——BUG-20260908-024 仅豁免 planned，其余五档（待接受/已接受/开发中/待测试/已完成）仍渲染。
- 「待测试」是展示层派生分类（in-progress 且 `agentCompletedAt`），并非独立存储状态；去重展示不得改动 `laneOf` 分类规则。

## 方案（实施记录）

- `reqRowEl()` 整行删除状态 chip 拼接（六档统一不渲染，REQ / BUG 同口径），模板直接删除而非 CSS 隐藏，首行自然收拢、无空占位。
- 状态语义保留通道不动：顶部六档筛选条（名称+计数+选中态）、行悬停 `LANE_HINT`、详情抽屉「状态」字段与上报横幅、下属 Bug「待测试」角标。
- 同步删除 `style.css` 中失去引用的 `.req-row .state` 规则（详情抽屉状态字段仍由通用 `span.state` 承载，不改）。
- 测试契约更新（先红后绿，红 11 例→绿）：
  - `scripts/tests/planned-chip-dedup.test.mjs`：T2 由「其余五档保留 chip」反转为六档（含 BUG 条目）去重断言；新增 T2b 死样式清理断言；
  - `scripts/tests/card-flag-dedup.test.mjs` T1–T3：「待测试恰好一次（chip）」升级为「0 次」，保留不叠加 flag 角标与详情语义断言；
  - `scripts/tests/confirm-lane.test.mjs` T3/T8、`scripts/tests/req-filter-removed.test.mjs` T5、`scripts/tests/accepted-batch-entry.test.mjs` L1–L3：行级 chip 断言反转为去重，批次文案禁令与详情断言不变。
- 明确不改：`laneOf`/`applyReqFilter`/`visibleItems` 分类与过滤、`renderFilterBar`、完善三态徽标及跳转、「模型配置待处理」提示、待接受行内操作、复选框、复制按钮、讨论模块 `oncall.js` 列表（README「待确认与关联」列为范围外）。

## 风险与边界

- 移除行内标签后，列表中识别条目档位依赖顶部筛选条与行悬停提示；详情抽屉仍显示完整状态（含待测试角标与上报横幅），信息不丢失。
- 长单号/多控件行因 chip 移除自然收拢；`card-top` 仍为 flex-wrap 布局，不新增横向溢出。
- 讨论模块 `oncall.js` 逐条状态展示是否纳入去重待确认，本轮未动。
- 全量回归：`npm test` 104 个测试文件全部通过；实施中未发现新问题，无需登记新 Bug。
