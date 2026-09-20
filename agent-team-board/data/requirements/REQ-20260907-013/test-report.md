# 测试报告 — REQ-20260907-013 支持当前已有批次执行中时，可以创建新批次。没在执行中的新批次可以被删除。

- 时间：2026-09-07T23:47:34.356Z
- 执行者：zcode-batch-010-1
- 测试框架：node:test（自研用例聚合）
- 覆盖率：9%

## 总结

批次删除全栈：core deleteBatch（在途运行/needs_attention 拒绝，仅删批次账本、runs 与条目不动，队列动态前移）；CLI atb batch delete；API POST /api/batch/delete；看板排队列表项与当前批次（无在途）删除入口（uiConfirm 确认）；执行中面板新增「排队新批次」按钮复用创建流程。测试 batch-delete.test.mjs 9 用例（C1+D1-D8）全通过，npm test 74 文件回归 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
