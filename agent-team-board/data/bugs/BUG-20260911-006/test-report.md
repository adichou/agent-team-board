# 测试报告 — BUG-20260911-006 全局任务中需要加上批量 Commit 的任务状态

- 时间：2026-09-11T02:40:11.939Z
- 执行者：zcode-batch-035-3
- 测试框架：node:assert + http 集成
- 覆盖率：95%

## 总结

全局聚合纳入批量 Commit：commit-store 新增只读 commitBatchBrief（不调 checkCommitBatch/不碰锁），server projectTaskRows 加 commit 段且 corruptBatchIds 扫描覆盖 commits/batches；前端类型筛选/徽标/计数（已提交=committed，异常=失败+中断）/跳转（commit→gotoRuns('commit')）增 commit 档；新增 C1-C5 用例先红后绿，C3 验证账本逐字节只读；归因 REQ-20260910-003（遗留项见 BUG-20260910-014）；全量 189 测试文件失败 0

## 明细

（可粘贴命令输出、失败用例说明等）
