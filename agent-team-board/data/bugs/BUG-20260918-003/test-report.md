# 测试报告 — BUG-20260918-003 确认留痕 confirmations.md 属应用数据，应迁至 runtime 不进 git

- 时间：2026-09-19T01:17:01.508Z
- 执行者：zcode-batch-050-001
- 测试框架：node:assert/strict + npm test（280 文件全量回归）
- 覆盖率：100%

## 总结

确认/决策留痕迁 runtime：renderConfirmDoc→runtime/confirms/confirmations/<ID>.md、renderDecisionsDoc→runtime/holds/decisions/<ID>.md（条目目录零写入，指纹自指循环消除）；orderedDocs 过滤两留痕文件（页签/搜索同源）；owningItemIdOf 将其归板级共享（出库迁移随本单 doc 提交带单号）；CLI/前端/i18n 提示改 runtime 路径（双语同步）；历史 6 条目 confirmations.md 已移入 runtime 待收口提交；npm test 全量 280 文件通过

## 明细

（可粘贴命令输出、失败用例说明等）
