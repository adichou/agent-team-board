# 测试报告 — REQ-20260923-002 开发收口恢复提交条目文档并忽略根目录文档变更（回退 REQ-20260922-007）

- 时间：2026-09-23T08:08:54.039Z
- 执行者：zcode-batch-065-2
- 测试框架：node:test
- 覆盖率：未统计

## 总结

回退 REQ-20260922-007：收口归因恢复提交本单条目目录文档（doc: 标题 单号 随收口入库）；新增根第一层 .md 文档忽略口径（不进任何分组、不触发 pendingManual 暂扣，差异保留工作区走人工/发布文档流程，ignoredDocs 如实携带）；confirmScopeForRun 同步跳过根文档；AGENTS.md / SKILL.md / dev-closeout.md 表述同步。新增 req-20260923-002.test.mjs（N1-N9 全绿）并移除 req-20260922-007.test.mjs，修订 confirm-block / dev-flow / bug-report-closeout / auto-commit-pre-dirty 四处 007 期间断言；npm test 全量 337 文件通过

## 明细

（可粘贴命令输出、失败用例说明等）
