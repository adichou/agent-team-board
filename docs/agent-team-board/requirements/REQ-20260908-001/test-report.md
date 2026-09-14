# 测试报告 — REQ-20260908-001 任务看板的批次记录上，需要显示每个单的标题，放到单号的后面

- 时间：2026-09-08T01:11:50.077Z
- 执行者：zcode-batch-011-01
- 测试框架：node:assert 单测 + 静态契约（batch-core/batch-ui；run-all.mjs 全量 76 文件回归）
- 覆盖率：5%

## 总结

批次记录带条目标题：lib/batch.mjs listRuns 记录增加 title（条目删除容错空串，/api/batch/records 与 batchSummary.records 自动带出）；web/app.js recordsHtml 单号后渲染标题（shortOwner 截断 + title 悬停），任务搜索过滤纳入标题；style.css 增 .batch-record .rec-title。TDD：2 个新用例先红后绿，全量 76 测试文件通过。

## 明细

（可粘贴命令输出、失败用例说明等）
