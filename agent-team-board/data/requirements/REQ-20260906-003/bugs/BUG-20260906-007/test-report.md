# 测试报告 — BUG-20260906-007 网络退避期间停止当前执行后重试仍会唤起新进程

- 时间：2026-09-06T16:00:30.863Z
- 执行者：zcode-batch-002-7
- 测试框架：node:test
- 覆盖率：90%

## 总结

stopCurrent 在网络退避等待期（retryTimer 挂起、无活进程、旧 handle cancel 无效）撤销待执行重试并直接落账 interrupted/user-stop、finishRun 释放占用；scheduleRetry 回调补与续跑路径一致的内存+账本 cancelRequested 双重核对防竞态复活。新增 D19 用例先红后绿（红象与探针 C-A4 一致），C-A4 探针转绿；scheduler 21 用例全过，run-all 42/43（唯一失败 detail-close-btn 为既有 BUG-20260906-017，与本改动无关）。引入来源归因 REQ-20260906-003 已写入 README 关联节。

## 明细

（可粘贴命令输出、失败用例说明等）
