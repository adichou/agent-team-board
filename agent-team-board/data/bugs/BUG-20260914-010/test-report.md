# 测试报告 — BUG-20260914-010 批量开发暂扣待人工提交的改动缺少人工提醒通道

- 时间：2026-09-14T06:20:47.782Z
- 执行者：zcode-batch-048-BUG-20260914-010
- 测试框架：node:assert/strict + 真实 git 临时仓库端到端 + 真实 server HTTP
- 覆盖率：8%

## 总结

暂扣待人工提交补齐三条提醒通道：batch check notice（continue/stop 均列暂扣单数+明细入口，≤2048B）；/api/holds 携带 pendingCommits + 看板「待人工提交」分组（明细/建议/2 秒轮询/提交后消失，判据为账本路径仍脏，共用 gitFlow.pendingManualRuns）；调度提示词补 pendingManual 立即报告指令。TDD 8 用例先红后绿，全量 227 文件 0 失败。归因 BUG-20260913-006。

## 明细

（可粘贴命令输出、失败用例说明等）
