# 测试报告 — BUG-20260910-018 排序下拉组件没有和搜索框平齐，请修复

- 时间：2026-09-10T15:16:58.467Z
- 执行者：zcode-batch-20260910-032-02
- 测试框架：node:test
- 覆盖率：100%

## 总结

归因REQ-016（高度侧已由REQ-025修复并守护）。根因：定位组内搜索组>720px仍受基础.global-search的min-width:140px保底，组内不堆叠仅靠≤720px媒体查询emergent保证。修复：style.css新增.page-head .locate-group .module-search{min-width:0}（作用域限定），组内恒左右相邻不堆叠不裁切无横向滚动；flex-wrap:wrap与025等高32px口径原样保留。TDD：新增B1-B6六用例，跑红→绿；016/025回归与全量npm test（174文件）0失败。

## 明细

（可粘贴命令输出、失败用例说明等）
