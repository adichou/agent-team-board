# 测试报告 — REQ-20260907-006 去掉全部需求的过滤条件

- 时间：2026-09-07T14:27:39.381Z
- 执行者：zcode-batch-007-1
- 测试框架：node 契约/沙箱测试（npm test）
- 覆盖率：100%

## 总结

移除需求模块第四行状态筛选条：index.html 删 #filterBar；app.js 删 reqFilter/REQ_FILTERS/applyReqFilter/renderFilterBar/事件委托，visibleItems 简化为全量，空态文案只提搜索；style.css 删 .filter-bar/.filter-chip/.filter-count。laneOf/LANE_LABEL 行状态展示与讨论模块筛选保留。新增 req-filter-removed.test.mjs（5 用例，TDD 先红后绿），同步更新 workbench-layout W5、confirm-lane T3/T5、pending-alignment R5、view-tabs-style V3、refresh-default-view 初始 hidden 集；npm test 65 文件全部通过。

## 明细

（可粘贴命令输出、失败用例说明等）
