# 测试报告 — BUG-20260919-001 已终止批次被在途回执复活为 running，队首永久 stop=aborted 阻塞后续批次派发

- 时间：2026-09-19T02:05:05.588Z
- 执行者：zcode-batch-050-005
- 测试框架：node:assert/strict 回归脚本
- 覆盖率：90%

## 总结

finishRun 收尾 guard abortRequested（已终止批次不复活，回执照常落账）+ abortBatch 幂等分支自愈（修复复活账本/补出局/清 currentRunId，不动后续批次实施锁）；新增 bug-20260919-001.test.mjs 5 用例先红后绿，npm test 283 文件全过；引入来源 REQ-20260908-020

## 明细

（可粘贴命令输出、失败用例说明等）
