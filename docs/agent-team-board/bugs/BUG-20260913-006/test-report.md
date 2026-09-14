# 测试报告 — BUG-20260913-006 批量实施 auto-commit 漏提交业务源码：预留时已脏的 build.js 永远不入任何单的提交，HEAD 上已提交的 test/biz 组合自相矛盾 zcode-batch-047-1

- 时间：2026-09-14T01:23:03.290Z
- 执行者：zcode-batch-048-4
- 测试框架：node:assert 自研 runner（新增 auto-commit-pre-dirty-20260913-006.test.mjs 6 用例 + 全量回归 218 文件 0 失败）
- 覆盖率：100%

## 总结

快照升级：预留时已脏的已跟踪文件记录内容哈希（trackedHashes）；diffWorkingTree 区分 changed/dirtyTouched（同码内容变），旧快照无基线维持旧行为。处置层：此类路径列入 pendingManual（回执+auto-commit.json 明细含建议），不再静默留脏；本单 test/业务组一并暂扣（heldGroups）保证提交历史自洽；doc 组照常；无提交时不点亮徽标。引入来源已归因 REQ-20260911-009。

## 明细

（可粘贴命令输出、失败用例说明等）
