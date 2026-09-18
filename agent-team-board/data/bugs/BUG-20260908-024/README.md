# BUG-20260908-024 已计划界面中的单子不需要再显示已计划标签了

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260908-010（引入「已计划」状态分类：LANES 增设 planned 档与 LANE_LABEL「已计划」标签，列表卡片模板沿用 REQ-20260907-004 的通用 lane chip 渲染，使已计划档内每张卡片出现与档位重复的「已计划」chip；经 `atb list` 核验在册）
- 创建：2026-09-08T15:49:54.964Z

## 现象

需求视图第四行状态筛选条（BUG-20260907-016 恢复的六档筛选）切到「已计划」档后，该档内每一张条目卡片在单号旁仍渲染一个「已计划」状态 chip（`scripts/web/app.js` `reqRowEl` 卡片模板，约 1143 行：`${lane === 'accepted' ? acceptedEntryChip(it) : `<span class="state s-${it.status}">${LANE_LABEL[lane]}</span>`}`，planned 行即 `<span class="state s-planned">已计划</span>`）。

由于列表本身按档位过滤（`applyReqFilter`，`scripts/web/app.js:1094`——`items.filter((it) => laneOf(it) === state.reqFilter)`），已计划条目只会出现在「已计划」档内：每张卡片的标签与所在档位完全重复，无任何增量信息，只占用卡片顶部空间，视觉噪音。

同类冗余此前已有先例收敛，本 Bug 是同一方向的遗漏：

- 已接受档的「已接受」标签已替换为「已入批次 / 未入批次」chip（REQ-20260907-012，`acceptedEntryChip`）；
- 「待测试」角标已在列表卡片上与 lane 状态 chip 去重（BUG-20260907-010，角标仅保留在无 lane chip 的位置）。

## 复现步骤

1. 启动 Status Board 服务：`node scripts/server.mjs`（默认端口 8888，见 `scripts/server.mjs:1717` 与项目 README），浏览器打开 `http://localhost:8888`（Electron 入口 `npm run app` 为同一界面）。
2. 准备数据：在「已接受」档勾选一条已接受条目，点工具条「移入计划」（REQ-20260908-018），使其进入 `planned` 状态；或确认看板中已存在已计划条目。
3. 在需求视图第四行状态筛选条点击「已计划」档。
4. 观察该档内任一卡片：单号右侧仍显示「已计划」状态 chip，与档位名称重复。

## 期望行为

- 「已计划」档内的列表卡片不再渲染「已计划」状态 chip（对 `reqRowEl` 中 planned 分支的 `<span class="state s-planned">` 收敛；具体方案由 design.md 确定）。
- 卡片其余信息保持不变：多选框（进入批量开发 / 移出计划）、单号、标题、认领者、更新时间、行内操作按钮均不受影响。
- 行悬停提示不受影响：已计划行 title 仍为 `LANE_HINT.planned`「已排入开发计划，开发启动后最旧优先处理」（`scripts/web/app.js:18`），悬停仍可获知状态语义。
- 其他五个档位（待接受 / 已接受 / 开发中 / 待测试 / 已完成）卡片的状态 chip 显示不变；已接受档的「已入批次 / 未入批次」chip 不受影响。
- 详情抽屉的状态字段（`scripts/web/app.js:2131`，按 `STATE_LABEL` 显示）不受本 Bug 约束：抽屉可从任意入口打开，状态是必要的上下文信息，仍正常显示。

## 验收说明

- 手工验收：按复现步骤切到「已计划」档，确认卡片上无「已计划」chip；逐一切换其余五档，确认各档卡片状态 chip 正常显示（待接受 / 已入批次或未入批次 / 开发中 / 待测试 / 已完成）。
- 回归点：`reqRowEl`（`scripts/web/app.js`）为唯一改动面时，跑既有前端源断言测试确认无破坏——`scripts/tests/planned-state.test.mjs`（REQ-20260908-010 已计划档 UI 用例）、`scripts/tests/impl-entry-ui.test.mjs`（已计划卡片复选框/多选）、`scripts/tests/accepted-batch-entry.test.mjs`（已接受 chip）、`scripts/tests/card-flag-dedup.test.mjs`（BUG-20260907-010 去重）；若其中有断言 planned 卡片含状态 chip 的用例需同步调整。
- 视觉验收：卡片顶部不因移除 chip 出现明显布局塌陷（chip 为行内元素，`.req-row .card-top` 布局应保持稳定）。
