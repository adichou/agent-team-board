# 测试报告 — BUG-20260908-020 已接受单的批次相关的显示需要删除

- 时间：2026-09-08T16:30:21.854Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert 自研用例（scripts/tests/run-all.mjs 全量 96 文件）
- 覆盖率：90%

## 总结

删除已接受单批次进入状态显示：app.js 删 acceptedEntryChip/acceptedEntryTitle，卡片与详情恢复通用「已接受」chip（LANE_HINT/STATE_LABEL），notice accepted 分支恒为移入计划//dev 指引，列表签名移除 batchEntry；server.mjs 的 /api/board 与 /api/item/:id 将 batchEntry 附加收窄至 planned（accepted 不再下发），planned notice 与批量实施面板不动；accepted-batch-entry.test.mjs 同步改写（先红后绿），run-all 96 文件失败 0。引入来源：REQ-20260907-012（引入显示）/REQ-20260908-010（口径切换使其失效），均经 atb list 核验，已写入 design.md 与 README 头部。

## 明细

（可粘贴命令输出、失败用例说明等）
