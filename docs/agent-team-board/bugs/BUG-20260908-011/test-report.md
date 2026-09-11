# 测试报告 — BUG-20260908-011 批量完善创建后人工编辑导致待领取条目被跳过

- 时间：2026-09-08T15:11:41.383Z
- 执行者：zcode-batch-018-12
- 测试框架：node:assert/strict 自研测试（scripts/tests/refine-claim-baseline.test.mjs + 深测夹具 deep-probes.mjs）
- 覆盖率：90%

## 总结

refine-store：nextRefineItem 领取时重冻结文档基线（写运行前持久化），移除「冻结后人工编辑基线失效」领取门槛——创建/吸收到领取之间的人工编辑不再 skip（D02 转 PASS）；done 核验以领取时基线为准（领取后未改文档仍拒），目录损坏/离开 accepted 出局与账目不回归；更新旧口径用例 R5/V5；npm test 95 文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
