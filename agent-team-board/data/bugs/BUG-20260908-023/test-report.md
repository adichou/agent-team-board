# 测试报告 — BUG-20260908-023 已终止/已结束的开发批次可被暂停操作复活为未结束状态

- 时间：2026-09-08T18:01:28.064Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert/strict + HTTP 集成 + CLI 端到端 + vm 沙箱
- 覆盖率：100%

## 总结

对齐 BUG-20260908-015 方案：batch.mjs 新增 batchTerminalReason 终态判定 + pauseBatch 幂等拒绝（不写 pauseRequested/不改 status，两方向一致）；CLI batch pause 与 HTTP /api/batch/pause 透传明确错误（die / 400 AtbError）；UI terminal 隐藏口径以 U16 vm 渲染测试锁定。新增 4 用例先红后绿；全套件 99 文件 0 失败。归因 REQ-20260906-002（暴露交互 REQ-20260908-020）。新发现 /api/batch/current 未透出 aborted 已登记 BUG-20260909-001

## 明细

（可粘贴命令输出、失败用例说明等）
