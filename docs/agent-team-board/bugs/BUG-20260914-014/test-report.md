# 测试报告 — BUG-20260914-014 回退 BUG-20260914-010

- 时间：2026-09-14T07:58:18.380Z
- 执行者：zcode-batch-048-18
- 测试框架：node:test-style custom scripts/tests/run-all.mjs (229 files)
- 覆盖率：100%

## 总结

回退 BUG-20260914-010 全部 7 处改动（提示词指令/checkBatch 暂扣 notice/pendingManualRuns/API pendingCommits/看板待人工提交分组/i18n 词条/style 选择器/010 测试删除），残留 grep 清零、行为回归 010 前；新增 bug-revert-held-notice-20260914-014.test.mjs 7 用例 TDD（5 红→全绿）；全量 229 文件 0 失败；他人单改动与 010 历史文档账本完好；归因 BUG-20260914-010（atb list 核验）。回退撤除随人工授权补交批入库，014 测试由收尾自动提交归因

## 明细

（可粘贴命令输出、失败用例说明等）
