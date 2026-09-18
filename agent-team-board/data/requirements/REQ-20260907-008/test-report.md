# 测试报告 — REQ-20260907-008 讨论视图精简：删除头部说明区，状态筛选与需求栏样式统一并去掉「全部」

- 时间：2026-09-07T23:04:36.173Z
- 执行者：zcode-batch-010-1
- 测试框架：node:assert + run-all.mjs
- 覆盖率：5%

## 总结

讨论视图精简：删头部说明区（新建统一顶栏「＋ 新建」）；筛选 chip 改 filter-chip+filter-count 与需求栏一致并弃用 oc-filter；去「全部」档缺省「待回复」；空态指向顶栏。新增 oncall-view-lean.test.mjs（4 用例先红后绿），更新 req-filter-removed T5 断言，全量 71 测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
