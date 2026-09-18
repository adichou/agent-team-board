# 测试报告 — REQ-20260910-013 增加一个批量commit 的功能，要求参考批量完善和批量开发的。

- 时间：2026-09-10T06:44:29.782Z
- 执行者：zcode-batch-031-15
- 测试框架：node:assert/strict + CLI 端到端（真实 git 仓库夹具）
- 覆盖率：70%

## 总结

新增 atb commit 批量流程（create/next/done/fail/release/check/summary/records/pause/abort），与 batch/refine 同构：默认候选=done 单、--include-reported 纳入已上报待确认、--ids 圈定；git 历史含单号即幂等出局（create 过滤+next 落 skipped 账）；done 核验五类前缀/含单号/描述≤20字/测试业务分离/条目目录 doc 类；账本 docs/agent-team-board/commits/（CMT 批次+run 含 hash）；占用 impl.lock 与开发互斥；只读 git，不 push 不动工作区。新测试 commit-batch-20260910-013.test.mjs 8 用例先红后绿；npm test 全量 148 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
