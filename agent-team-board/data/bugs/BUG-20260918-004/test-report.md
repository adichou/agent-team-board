# 测试报告 — BUG-20260918-004 确认闭环全量测试硬编码 600 秒超时，长套件永远无法通过确认

- 时间：2026-09-19T01:47:41.859Z
- 执行者：zcode-batch-050-004
- 测试框架：node:assert/strict 自研用例脚本（npm test）
- 覆盖率：未统计

## 总结

确认/核验测试超时与批次执行同口径：confirm-store 新增 confirmTestTimeoutMs（run.timeoutMin → settings.timeoutMin → 默认 60 分钟，run 账本缺失容错回退）；server startConfirmTask 硬编码 36_000_000 改口径取值；runProjectTests(Sync) 默认参数 600_000 统一为 60 分钟；前端 watchConfirmTask 观察窗口与超时上限展示随口径对齐（无文案改动）。引入来源：BUG-20260915-008（同步上限源自 REQ-20260914-001）。新增 bug-20260918-004.test.mjs 9 用例（口径链 / HTTP 随设置与 run 生效 / 账本落账 / 源码护栏 / 短套件回归）；npm test 全量 282 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
